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
import { eq, and, desc, sql } from "drizzle-orm";
import { parseFile } from "@/lib/import-parser";
import { parseAirRow, buildAirExtraData, AIR_SUPPLIER_CODE } from "@/lib/connectors/air";
import { calculateSupplierCost } from "@/lib/pricing";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getOrCreateAirSupplier() {
  let supplier = db.select().from(suppliers).where(eq(suppliers.code, AIR_SUPPLIER_CODE)).get();

  if (!supplier) {
    supplier = db.insert(suppliers).values({
      code: AIR_SUPPLIER_CODE,
      name: "AIR Computers",
      currency: "USD",
      taxRate: 0,
      isActive: true,
      connectorType: "manual",
      notes: "Proveedor mayorista - Stock principal en LUG",
    }).returning().get();
  }

  return supplier;
}

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplier = getOrCreateAirSupplier();
    const exchangeRate = getEffectiveExchangeRate();

    if (!exchangeRate) {
      return NextResponse.json(
        { error: "No hay tipo de cambio disponible. Configure uno primero." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No se proporcionó archivo" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "El archivo excede el límite de 10MB" }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseFile(buffer, file.name);

    if (parsed.rows.length === 0) {
      return NextResponse.json({ error: "No se encontraron filas de datos" }, { status: 400 });
    }

    let linkedCount = 0;
    let processedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];
    let catalogId = 0;

    db.$client.transaction(() => {
      const catalog = db.insert(supplierCatalogs).values({
        supplierId: supplier.id,
        filename: file.name,
        rowCount: parsed.rows.length,
        status: "processing",
      }).returning().get();
      catalogId = catalog.id;

      for (const row of parsed.rows) {
        try {
          const airItem = parseAirRow(row);

          if (!airItem) {
            skippedCount++;
            continue;
          }

          processedCount++;

          const catalogItem = db.insert(supplierCatalogItems).values({
            catalogId: catalog.id,
            supplierCode: airItem.codigo,
            description: airItem.descripcion,
            price: airItem.precioUsd,
            currency: "USD",
            stockAvailable: airItem.hasStock,
            rawData: buildAirExtraData(airItem),
          }).returning().get();

          const existingLink = db.select()
            .from(productSupplierLinks)
            .where(
              and(
                eq(productSupplierLinks.supplierId, supplier.id),
                eq(productSupplierLinks.supplierCode, airItem.codigo)
              )
            )
            .get();

          if (existingLink) {
            const product = db.select().from(products).where(eq(products.id, existingLink.productId)).get();

            if (product) {
              const finalIvaRate = airItem.ivaRate;
              const finalInternalTaxRate = airItem.internalTaxRate;

              if (product.ivaRate !== finalIvaRate || product.internalTaxRate !== finalInternalTaxRate) {
                db.update(products)
                  .set({
                    ivaRate: finalIvaRate,
                    internalTaxRate: finalInternalTaxRate,
                    updatedAt: sql`(datetime('now'))`,
                  })
                  .where(eq(products.id, product.id))
                  .run();
              }

              const finalCostArs = calculateSupplierCost(
                airItem.precioUsd,
                finalIvaRate,
                supplier.taxRate,
                finalInternalTaxRate,
                exchangeRate
              );

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
                    rawPrice: airItem.precioUsd,
                    currency: "USD",
                    exchangeRate,
                    finalCostArs,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(supplierPrices.id, existingPrice.id))
                  .run();
              } else {
                db.insert(supplierPrices).values({
                  linkId: existingLink.id,
                  rawPrice: airItem.precioUsd,
                  currency: "USD",
                  exchangeRate,
                  finalCostArs,
                }).run();
              }

              db.insert(priceHistory).values({
                linkId: existingLink.id,
                rawPrice: airItem.precioUsd,
                currency: "USD",
                exchangeRate,
                finalCostArs,
              }).run();

              db.update(productSupplierLinks)
                .set({ supplierStockQty: airItem.stockLug })
                .where(eq(productSupplierLinks.id, existingLink.id))
                .run();

              db.update(supplierCatalogItems)
                .set({ linkedProductId: product.id, matchConfidence: 1.0 })
                .where(eq(supplierCatalogItems.id, catalogItem.id))
                .run();

              linkedCount++;
            }
          }
        } catch (rowError) {
          errors.push(`Row error: ${rowError instanceof Error ? rowError.message : 'Unknown'}`);
        }
      }

      db.update(supplierCatalogs)
        .set({ status: "completed", linkedCount, rowCount: processedCount })
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
        .run(supplier.id, catalog.id);

      // Recompute has_supplier_stock for all products linked to this supplier.
      // Checks ALL active supplier links so multi-supplier stock is respected.
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
        .run(supplier.id);
    })();

    try { runOfferDetection(); } catch (e) { console.warn("[air-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[air-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[air-import] refreshAllBuscador failed:", e); }

    return NextResponse.json({
      success: true,
      catalogId,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      stats: {
        totalRows: parsed.rows.length,
        processed: processedCount,
        skipped: skippedCount,
        linked: linkedCount,
        unlinked: processedCount - linkedCount,
      },
      exchangeRate,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error("AIR import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

// GET: Get AIR supplier info
export async function GET() {
  try {
    const supplier = db.select().from(suppliers).where(eq(suppliers.code, AIR_SUPPLIER_CODE)).get();

    if (!supplier) {
      return NextResponse.json({
        exists: false,
        message: "AIR supplier will be created on first import",
      });
    }

    const latestCatalog = db.select()
      .from(supplierCatalogs)
      .where(eq(supplierCatalogs.supplierId, supplier.id))
      .orderBy(desc(supplierCatalogs.importedAt))
      .limit(1)
      .get();

    const linkedCount = db.select({ count: sql<number>`count(*)` })
      .from(productSupplierLinks)
      .where(eq(productSupplierLinks.supplierId, supplier.id))
      .get();

    return NextResponse.json({
      exists: true,
      supplier: {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        currency: supplier.currency,
        taxRate: supplier.taxRate,
      },
      linkedProducts: linkedCount?.count ?? 0,
      latestImport: latestCatalog ? {
        id: latestCatalog.id,
        filename: latestCatalog.filename,
        rowCount: latestCatalog.rowCount,
        linkedCount: latestCatalog.linkedCount,
        importedAt: latestCatalog.importedAt,
        status: latestCatalog.status,
      } : null,
    });
  } catch (error) {
    console.error("AIR GET error:", error);
    return NextResponse.json({ error: "Failed to get AIR info" }, { status: 500 });
  }
}
