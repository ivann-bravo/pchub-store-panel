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
  parseLatamlyXLSX,
  buildLatamlyExtraData,
  parseLatamlyStockConfig,
  LATAMLY_SUPPLIER_CODE,
  type LatamlyCatalogItem,
} from "@/lib/connectors/latamly";
import { calculateSupplierCost } from "@/lib/pricing";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function getLatamlySupplier() {
  const candidates = db
    .select()
    .from(suppliers)
    .where(sql`UPPER(${suppliers.code}) = 'LATAMLY'`)
    .all();

  if (candidates.length > 0) {
    return candidates.sort((a, b) => a.id - b.id)[0];
  }

  return db
    .insert(suppliers)
    .values({
      code: LATAMLY_SUPPLIER_CODE,
      name: "Latamly",
      currency: "USD",
      taxRate: 0.05,
      isActive: true,
      connectorType: "manual",
      stockConfig: JSON.stringify({ enStockQty: 10 }),
      notes: "Proveedor mayorista — Lista XLSX multi-hoja (una por marca). Sin impuestos internos.",
    })
    .returning()
    .get();
}

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplier = getLatamlySupplier();
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

    const stockConfig = parseLatamlyStockConfig(supplier.stockConfig);
    const buffer = Buffer.from(await file.arrayBuffer());
    const items = parseLatamlyXLSX(buffer, stockConfig);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "No se encontraron productos válidos en el archivo" },
        { status: 400 }
      );
    }

    // Deduplicar por SKU: conservar el precio más bajo
    const deduped = new Map<string, LatamlyCatalogItem>();
    for (const item of items) {
      const existing = deduped.get(item.sku);
      if (!existing || item.precioSinIva < existing.precioSinIva) {
        deduped.set(item.sku, item);
      }
    }

    let linkedCount = 0;
    let processedCount = 0;
    const errors: string[] = [];
    let catalogId = 0;

    db.$client.transaction(() => {
      const catalog = db
        .insert(supplierCatalogs)
        .values({
          supplierId: supplier.id,
          filename: file.name,
          rowCount: items.length,
          status: "processing",
        })
        .returning()
        .get();
      catalogId = catalog.id;

      for (const latamlyItem of Array.from(deduped.values())) {
        try {
          processedCount++;

          const catalogItem = db
            .insert(supplierCatalogItems)
            .values({
              catalogId: catalog.id,
              supplierCode: latamlyItem.sku,
              description: latamlyItem.descripcion,
              price: latamlyItem.precioSinIva,
              currency: "USD",
              stockAvailable: latamlyItem.hasStock,
              rawData: buildLatamlyExtraData(latamlyItem),
            })
            .returning()
            .get();

          // Buscar link existente
          const existingLink = db
            .select()
            .from(productSupplierLinks)
            .where(
              and(
                eq(productSupplierLinks.supplierId, supplier.id),
                eq(productSupplierLinks.supplierCode, latamlyItem.sku)
              )
            )
            .get();

          // Si no hay link por supplierCode, intentar auto-vincular por SKU exacto
          let resolvedLink = existingLink;
          if (!resolvedLink) {
            const productBySku = db
              .select()
              .from(products)
              .where(sql`UPPER(TRIM(${products.sku})) = UPPER(TRIM(${latamlyItem.sku}))`)
              .get();

            if (productBySku) {
              const existingByProduct = db
                .select()
                .from(productSupplierLinks)
                .where(
                  and(
                    eq(productSupplierLinks.productId, productBySku.id),
                    eq(productSupplierLinks.supplierId, supplier.id)
                  )
                )
                .get();

              if (existingByProduct) {
                resolvedLink = existingByProduct;
              } else {
                const finalCostArs = calculateSupplierCost(
                  latamlyItem.precioSinIva,
                  latamlyItem.ivaRate,
                  supplier.taxRate,
                  0,
                  exchangeRate
                );

                resolvedLink = db
                  .insert(productSupplierLinks)
                  .values({
                    productId: productBySku.id,
                    supplierId: supplier.id,
                    supplierCode: latamlyItem.sku,
                    supplierStockQty: latamlyItem.stockQty,
                    isActive: true,
                  })
                  .returning()
                  .get();

                db.update(products)
                  .set({
                    ivaRate: latamlyItem.ivaRate,
                    internalTaxRate: 0,
                    updatedAt: sql`(datetime('now'))`,
                  })
                  .where(eq(products.id, productBySku.id))
                  .run();

                db.insert(supplierPrices)
                  .values({
                    linkId: resolvedLink.id,
                    rawPrice: latamlyItem.precioSinIva,
                    currency: "USD",
                    exchangeRate,
                    finalCostArs,
                  })
                  .run();

                db.insert(priceHistory)
                  .values({
                    linkId: resolvedLink.id,
                    rawPrice: latamlyItem.precioSinIva,
                    currency: "USD",
                    exchangeRate,
                    finalCostArs,
                  })
                  .run();

                db.update(supplierCatalogItems)
                  .set({ linkedProductId: productBySku.id, matchConfidence: 1.0 })
                  .where(eq(supplierCatalogItems.id, catalogItem.id))
                  .run();

                linkedCount++;
              }
            }
          }

          // Actualizar link existente (precio + stock)
          if (resolvedLink && existingLink) {
            const product = db
              .select()
              .from(products)
              .where(eq(products.id, resolvedLink.productId))
              .get();

            if (product) {
              if (product.ivaRate !== latamlyItem.ivaRate) {
                db.update(products)
                  .set({
                    ivaRate: latamlyItem.ivaRate,
                    internalTaxRate: 0,
                    updatedAt: sql`(datetime('now'))`,
                  })
                  .where(eq(products.id, product.id))
                  .run();
              }

              const finalCostArs = calculateSupplierCost(
                latamlyItem.precioSinIva,
                latamlyItem.ivaRate,
                supplier.taxRate,
                0,
                exchangeRate
              );

              const existingPrice = db
                .select()
                .from(supplierPrices)
                .where(eq(supplierPrices.linkId, resolvedLink.id))
                .get();

              if (existingPrice) {
                db.insert(priceHistory)
                  .values({
                    linkId: resolvedLink.id,
                    rawPrice: existingPrice.rawPrice,
                    currency: existingPrice.currency,
                    exchangeRate: existingPrice.exchangeRate,
                    finalCostArs: existingPrice.finalCostArs,
                  })
                  .run();

                db.update(supplierPrices)
                  .set({
                    rawPrice: latamlyItem.precioSinIva,
                    currency: "USD",
                    exchangeRate,
                    finalCostArs,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(supplierPrices.id, existingPrice.id))
                  .run();
              } else {
                db.insert(supplierPrices)
                  .values({
                    linkId: resolvedLink.id,
                    rawPrice: latamlyItem.precioSinIva,
                    currency: "USD",
                    exchangeRate,
                    finalCostArs,
                  })
                  .run();
              }

              db.insert(priceHistory)
                .values({
                  linkId: resolvedLink.id,
                  rawPrice: latamlyItem.precioSinIva,
                  currency: "USD",
                  exchangeRate,
                  finalCostArs,
                })
                .run();

              // Stock viene directo del Excel (cantidad real)
              db.update(productSupplierLinks)
                .set({ supplierStockQty: latamlyItem.stockQty })
                .where(eq(productSupplierLinks.id, resolvedLink.id))
                .run();

              db.update(supplierCatalogItems)
                .set({ linkedProductId: product.id, matchConfidence: 1.0 })
                .where(eq(supplierCatalogItems.id, catalogItem.id))
                .run();

              linkedCount++;
            }
          }
        } catch (rowError) {
          errors.push(
            `Row error [${latamlyItem.sku}]: ${rowError instanceof Error ? rowError.message : "Unknown"}`
          );
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

    try { runOfferDetection(); } catch (e) { console.warn("[latamly-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[latamly-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[latamly-import] refreshAllBuscador failed:", e); }

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
    console.error("Latamly import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supplier = db
      .select()
      .from(suppliers)
      .where(sql`UPPER(${suppliers.code}) = 'LATAMLY'`)
      .get();

    if (!supplier) {
      return NextResponse.json({
        exists: false,
        message: "El proveedor Latamly se creará en la primera importación",
      });
    }

    const latestCatalog = db
      .select()
      .from(supplierCatalogs)
      .where(eq(supplierCatalogs.supplierId, supplier.id))
      .orderBy(desc(supplierCatalogs.importedAt))
      .limit(1)
      .get();

    const linkedCount = db
      .select({ count: sql<number>`count(*)` })
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
    console.error("Latamly GET error:", error);
    return NextResponse.json({ error: "Failed to get Latamly info" }, { status: 500 });
  }
}
