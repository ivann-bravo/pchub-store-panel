import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_IMPORT_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import {
  suppliers,
  supplierCatalogs,
  supplierCatalogItems,
  productSupplierLinks,
  supplierPrices,
  priceHistory,
  products,
} from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { parseFile, autoDetectColumns } from "@/lib/import-parser";
import { parseArgNumber } from "@/lib/number-format";
import { calculateSupplierCost } from "@/lib/pricing";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplierId = parseInt(params.id);
    const supplier = db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const mappingJson = formData.get("mapping") as string;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "El archivo excede el límite de 10MB" }, { status: 413 });
    }

    // Get current exchange rate for USD suppliers
    const exchangeRate = supplier.currency === "USD" ? getEffectiveExchangeRate() : 1;
    if (supplier.currency === "USD" && !exchangeRate) {
      return NextResponse.json(
        { error: "No hay tipo de cambio disponible. Configure uno primero." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseFile(buffer, file.name);

    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "No data rows found" }, { status: 400 });
    }

    // Use provided mapping or auto-detect
    const mapping = mappingJson ? JSON.parse(mappingJson) : autoDetectColumns(parsed.headers);

    let linkedCount = 0;
    let catalogId = 0;

    db.$client.transaction(() => {
      const catalog = db.insert(supplierCatalogs).values({
        supplierId,
        filename: file.name,
        rowCount: parsed.rows.length,
        status: "processing",
      }).returning().get();
      catalogId = catalog.id;

      for (const row of parsed.rows) {
        const code = mapping.code ? String(row[mapping.code] || "").trim() : null;
        const description = mapping.description ? String(row[mapping.description] || "").trim() : null;
        const priceStr = mapping.price ? String(row[mapping.price] || "") : null;
        const rawPrice = priceStr ? parseArgNumber(priceStr) : null;
        const stockStr = mapping.stock ? String(row[mapping.stock] || "").toLowerCase() : null;
        const stockAvailable = stockStr
          ? stockStr === "si" || stockStr === "yes" || stockStr === "1" || stockStr === "true" || parseInt(stockStr) > 0
          : null;

        const item = db.insert(supplierCatalogItems).values({
          catalogId: catalog.id,
          supplierCode: code,
          description,
          price: rawPrice,
          currency: supplier.currency,
          stockAvailable: stockAvailable,
          rawData: JSON.stringify(row),
        }).returning().get();

        if (code) {
          const existingLink = db.select()
            .from(productSupplierLinks)
            .where(
              and(
                eq(productSupplierLinks.supplierId, supplierId),
                eq(productSupplierLinks.supplierCode, code)
              )
            )
            .get();

          if (existingLink && rawPrice && rawPrice > 0) {
            const product = db.select().from(products).where(eq(products.id, existingLink.productId)).get();

            let finalCostArs: number;
            if (supplier.currency === "USD" && product) {
              finalCostArs = calculateSupplierCost(
                rawPrice,
                product.ivaRate,
                supplier.taxRate,
                product.internalTaxRate ?? 0,
                exchangeRate!
              );
            } else {
              finalCostArs = rawPrice * (1 + supplier.taxRate);
            }

            const existingPrice = db.select()
              .from(supplierPrices)
              .where(eq(supplierPrices.linkId, existingLink.id))
              .get();

            if (existingPrice) {
              db.insert(priceHistory).values({
                linkId: existingLink.id,
                rawPrice: existingPrice.rawPrice,
                currency: existingPrice.currency,
                exchangeRate: existingPrice.exchangeRate,
                finalCostArs: existingPrice.finalCostArs,
              }).run();

              db.update(supplierPrices)
                .set({
                  rawPrice,
                  currency: supplier.currency,
                  exchangeRate: supplier.currency === "USD" ? exchangeRate : null,
                  finalCostArs,
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(supplierPrices.id, existingPrice.id))
                .run();
            } else {
              db.insert(supplierPrices).values({
                linkId: existingLink.id,
                rawPrice,
                currency: supplier.currency,
                exchangeRate: supplier.currency === "USD" ? exchangeRate : null,
                finalCostArs,
              }).run();
            }

            db.insert(priceHistory).values({
              linkId: existingLink.id,
              rawPrice,
              currency: supplier.currency,
              exchangeRate: supplier.currency === "USD" ? exchangeRate : null,
              finalCostArs,
            }).run();

            db.update(supplierCatalogItems)
              .set({ linkedProductId: existingLink.productId, matchConfidence: 0.99 })
              .where(eq(supplierCatalogItems.id, item.id))
              .run();

            const stockQty = stockStr ? (parseInt(stockStr) || (stockAvailable ? 1 : 0)) : 0;
            db.update(productSupplierLinks)
              .set({ supplierStockQty: stockQty })
              .where(eq(productSupplierLinks.id, existingLink.id))
              .run();

            linkedCount++;
          }
        }
      }

      db.update(supplierCatalogs)
        .set({ status: "completed", linkedCount })
        .where(eq(supplierCatalogs.id, catalog.id))
        .run();

      db.$client
        .prepare(
          `UPDATE product_supplier_links
           SET supplier_stock_qty = 0
           WHERE supplier_id = ?
             AND supplier_stock_qty > 0
             AND supplier_code NOT IN (
               SELECT supplier_code FROM supplier_catalog_items
               WHERE catalog_id = ? AND supplier_code IS NOT NULL
             )`
        )
        .run(supplierId, catalog.id);

      // Recompute has_supplier_stock for all products linked to this supplier.
      db.$client
        .prepare(
          `UPDATE products
           SET has_supplier_stock = (
             SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
             FROM product_supplier_links
             WHERE product_id = products.id AND is_active = 1 AND supplier_stock_qty > 0
           )
           WHERE id IN (
             SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ?
           )`
        )
        .run(supplierId);

      if (mappingJson) {
        db.update(suppliers)
          .set({ columnMapping: mappingJson, updatedAt: new Date().toISOString() })
          .where(eq(suppliers.id, supplierId))
          .run();
      }
    })();

    try { runOfferDetection(); } catch (e) { console.warn("[generic-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[generic-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[generic-import] refreshAllBuscador failed:", e); }

    return NextResponse.json({
      catalogId,
      totalRows: parsed.rows.length,
      linkedCount,
      exchangeRate: supplier.currency === "USD" ? exchangeRate : null,
      status: "completed",
    });
  } catch (error) {
    console.error("Import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

// GET: Preview file without importing
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const supplier = db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json({
      supplier: { id: supplier.id, code: supplier.code, name: supplier.name },
      savedMapping: supplier.columnMapping ? JSON.parse(supplier.columnMapping) : null,
    });
  } catch {
    return NextResponse.json({ error: "Failed to get import config" }, { status: 500 });
  }
}
