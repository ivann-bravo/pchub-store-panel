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
import {
  parseHdcXLSX,
  parseHdcStockConfig,
  buildHdcExtraData,
  HDC_SUPPLIER_CODE,
} from "@/lib/connectors/hdc";
import { calculateSupplierCost } from "@/lib/pricing";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getOrCreateHdcSupplier() {
  const existing = db
    .select()
    .from(suppliers)
    .where(sql`UPPER(${suppliers.code}) = 'HDC'`)
    .all();

  if (existing.length > 0) return existing.sort((a, b) => a.id - b.id)[0];

  return db.insert(suppliers).values({
    code: HDC_SUPPLIER_CODE,
    name: "HDC",
    currency: "USD",
    taxRate: 0.03,
    isActive: true,
    connectorType: "manual",
    stockConfig: JSON.stringify({ defaultStockQty: 10 }),
    notes: "Proveedor mayorista — Catálogo XLSX · Precio USD sin IVA · Sin impuestos internos",
  }).returning().get();
}

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplier = getOrCreateHdcSupplier();
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

    const stockConfig = parseHdcStockConfig(supplier.stockConfig);
    const buffer = Buffer.from(await file.arrayBuffer());
    const items = parseHdcXLSX(buffer, stockConfig);

    if (items.length === 0) {
      return NextResponse.json({ error: "No se encontraron filas de datos" }, { status: 400 });
    }

    // Deduplicar: conservar el precio más bajo por código
    const deduped = new Map<string, (typeof items)[0]>();
    for (const item of items) {
      const existing = deduped.get(item.codigo);
      if (!existing || item.precioSinIva < existing.precioSinIva) {
        deduped.set(item.codigo, item);
      }
    }

    let linkedCount = 0;
    let processedCount = 0;
    const errors: string[] = [];
    let catalogId = 0;

    db.$client.transaction(() => {
      const catalog = db.insert(supplierCatalogs).values({
        supplierId: supplier.id,
        filename: file.name,
        rowCount: items.length,
        status: "processing",
      }).returning().get();
      catalogId = catalog.id;

      for (const hdcItem of Array.from(deduped.values())) {
        try {
          processedCount++;

          const catalogItem = db.insert(supplierCatalogItems).values({
            catalogId: catalog.id,
            supplierCode: hdcItem.codigo,
            description: hdcItem.descripcion,
            price: hdcItem.precioSinIva,
            currency: "USD",
            stockAvailable: hdcItem.hasStock,
            rawData: buildHdcExtraData(hdcItem),
          }).returning().get();

          const existingLink = db.select()
            .from(productSupplierLinks)
            .where(
              and(
                eq(productSupplierLinks.supplierId, supplier.id),
                eq(productSupplierLinks.supplierCode, hdcItem.codigo)
              )
            )
            .get();

          if (existingLink) {
            const product = db.select().from(products).where(eq(products.id, existingLink.productId)).get();

            if (product) {
              if (product.ivaRate !== hdcItem.ivaRate || product.internalTaxRate !== 0) {
                db.update(products)
                  .set({
                    ivaRate: hdcItem.ivaRate,
                    internalTaxRate: 0,
                    updatedAt: sql`(datetime('now'))`,
                  })
                  .where(eq(products.id, product.id))
                  .run();
              }

              const finalCostArs = calculateSupplierCost(
                hdcItem.precioSinIva,
                hdcItem.ivaRate,
                supplier.taxRate,
                0,
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
                    rawPrice: hdcItem.precioSinIva,
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
                  rawPrice: hdcItem.precioSinIva,
                  currency: "USD",
                  exchangeRate,
                  finalCostArs,
                }).run();
              }

              db.insert(priceHistory).values({
                linkId: existingLink.id,
                rawPrice: hdcItem.precioSinIva,
                currency: "USD",
                exchangeRate,
                finalCostArs,
              }).run();

              db.update(productSupplierLinks)
                .set({ supplierStockQty: hdcItem.stockQty })
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
          errors.push(`Row error: ${rowError instanceof Error ? rowError.message : "Unknown"}`);
        }
      }

      db.update(supplierCatalogs)
        .set({ status: "completed", linkedCount, rowCount: processedCount })
        .where(eq(supplierCatalogs.id, catalog.id))
        .run();

      // Zero out links for items NOT in this catalog (discontinued / removed).
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

      // Safety net: also zero out links for items that ARE in the catalog
      // but have stock_available = 0 (e.g. Disponible=0 in new format).
      // Covers edge cases where the per-item update above was skipped.
      db.$client
        .prepare(
          `UPDATE product_supplier_links
           SET supplier_stock_qty = 0
           WHERE supplier_id = ?
             AND supplier_code IN (
               SELECT supplier_code FROM supplier_catalog_items
               WHERE catalog_id = ? AND stock_available = 0
             )`
        )
        .run(supplier.id, catalog.id);

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
        .run(supplier.id);
    })();

    try { runOfferDetection(); } catch (e) { console.warn("[hdc-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[hdc-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[hdc-import] refreshAllBuscador failed:", e); }

    return NextResponse.json({
      success: true,
      catalogId,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      stats: {
        totalRows: items.length,
        processed: processedCount,
        linked: linkedCount,
        unlinked: processedCount - linkedCount,
      },
      exchangeRate,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error("HDC import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supplier = db
      .select()
      .from(suppliers)
      .where(sql`UPPER(${suppliers.code}) = 'HDC'`)
      .get();

    if (!supplier) {
      return NextResponse.json({
        exists: false,
        message: "HDC supplier will be created on first import",
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
        stockConfig: supplier.stockConfig,
      },
      linkedProducts: linkedCount?.count ?? 0,
      latestImport: latestCatalog
        ? {
            id: latestCatalog.id,
            filename: latestCatalog.filename,
            rowCount: latestCatalog.rowCount,
            linkedCount: latestCatalog.linkedCount,
            importedAt: latestCatalog.importedAt,
            status: latestCatalog.status,
          }
        : null,
    });
  } catch (error) {
    console.error("HDC GET error:", error);
    return NextResponse.json({ error: "Failed to get HDC info" }, { status: 500 });
  }
}
