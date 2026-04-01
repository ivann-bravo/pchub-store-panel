import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_IMPORT_MSG } from "@/lib/demo";
import * as XLSX from "xlsx";
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
  parseAshirRow,
  buildAshirExtraData,
  parseAshirStockConfig,
  ASHIR_SUPPLIER_CODE,
  type AshirCatalogItem,
} from "@/lib/connectors/ashir";
import { calculateSupplierCost } from "@/lib/pricing";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Parse Ashir XLSX: header row is where col[0].toUpperCase() === 'COD. INTERNO'.
 * Rows above are company info to ignore.
 * Section-header rows (category names without price) are skipped inside parseAshirRow.
 */
function parseAshirXLSX(buffer: Buffer): Array<Record<string, unknown>> {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(30, rawData.length); i++) {
    const row = rawData[i] as unknown[];
    if (String(row[0] || "").trim().toUpperCase() === "COD. INTERNO") {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error('No se encontró la fila de encabezados ("COD. INTERNO") en las primeras 30 filas');
  }

  const headers = (rawData[headerRowIdx] as unknown[]).map((h) => String(h || "").trim());
  const rows: Array<Record<string, unknown>> = [];

  for (let i = headerRowIdx + 1; i < rawData.length; i++) {
    const rowData = rawData[i] as unknown[];
    if (!rowData || rowData.length === 0) continue;
    const firstCell = String(rowData[0] || "").trim();
    if (firstCell === "") continue;

    const row: Record<string, unknown> = {};
    headers.forEach((header, idx) => {
      const val = rowData[idx];
      row[header] = val != null && val !== "" ? val : null;
    });
    rows.push(row);
  }

  return rows;
}

function getOrCreateAshirSupplier() {
  const candidates = db
    .select()
    .from(suppliers)
    .where(sql`UPPER(${suppliers.code}) = 'ASHIR'`)
    .all();

  if (candidates.length > 0) {
    return candidates.sort((a, b) => a.id - b.id)[0];
  }

  return db.insert(suppliers).values({
    code: ASHIR_SUPPLIER_CODE,
    name: "Ashir Technology",
    currency: "USD",
    taxRate: 0,
    isActive: true,
    connectorType: "manual",
    stockConfig: JSON.stringify({ enStockQty: 15, lowStockQty: 10 }),
    notes: "Proveedor mayorista - Catálogo XLSX",
  }).returning().get();
}

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplier = getOrCreateAshirSupplier();
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

    const stockConfig = parseAshirStockConfig(supplier.stockConfig);
    const buffer = Buffer.from(await file.arrayBuffer());
    const rows = parseAshirXLSX(buffer);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No se encontraron filas de datos" }, { status: 400 });
    }

    // Parse all rows then deduplicate: keep lowest price per codigo
    const parsedItems: (AshirCatalogItem | null)[] = rows.map((row) =>
      parseAshirRow(row, stockConfig)
    );

    const deduped = new Map<string, AshirCatalogItem>();
    let skippedCount = 0;
    for (const item of parsedItems) {
      if (!item) { skippedCount++; continue; }
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
        rowCount: rows.length,
        status: "processing",
      }).returning().get();
      catalogId = catalog.id;

      for (const ashirItem of Array.from(deduped.values())) {
        try {
          processedCount++;

          const catalogItem = db.insert(supplierCatalogItems).values({
            catalogId: catalog.id,
            supplierCode: ashirItem.codigo,
            description: ashirItem.descripcion,
            price: ashirItem.precioSinIva,
            currency: "USD",
            stockAvailable: ashirItem.hasStock,
            rawData: buildAshirExtraData(ashirItem),
          }).returning().get();

          const existingLink = db.select()
            .from(productSupplierLinks)
            .where(
              and(
                eq(productSupplierLinks.supplierId, supplier.id),
                eq(productSupplierLinks.supplierCode, ashirItem.codigo)
              )
            )
            .get();

          if (existingLink) {
            const product = db.select().from(products).where(eq(products.id, existingLink.productId)).get();

            if (product) {
              const skuUpdate = ashirItem.sku && !product.sku ? { sku: ashirItem.sku } : {};
              if (
                product.ivaRate !== ashirItem.ivaRate ||
                Object.keys(skuUpdate).length > 0
              ) {
                db.update(products)
                  .set({
                    ivaRate: ashirItem.ivaRate,
                    internalTaxRate: 0,
                    ...skuUpdate,
                    updatedAt: sql`(datetime('now'))`,
                  })
                  .where(eq(products.id, product.id))
                  .run();
              }

              const finalCostArs = calculateSupplierCost(
                ashirItem.precioSinIva,
                ashirItem.ivaRate,
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
                    rawPrice: ashirItem.precioSinIva,
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
                  rawPrice: ashirItem.precioSinIva,
                  currency: "USD",
                  exchangeRate,
                  finalCostArs,
                }).run();
              }

              db.insert(priceHistory).values({
                linkId: existingLink.id,
                rawPrice: ashirItem.precioSinIva,
                currency: "USD",
                exchangeRate,
                finalCostArs,
              }).run();

              db.update(productSupplierLinks)
                .set({ supplierStockQty: ashirItem.stockQty })
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

    try { runOfferDetection(); } catch (e) { console.warn("[ashir-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[ashir-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[ashir-import] refreshAllBuscador failed:", e); }

    return NextResponse.json({
      success: true,
      catalogId,
      supplierId: supplier.id,
      supplierCode: supplier.code,
      stats: {
        totalRows: rows.length,
        processed: processedCount,
        skipped: skippedCount,
        linked: linkedCount,
        unlinked: processedCount - linkedCount,
      },
      exchangeRate,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
  } catch (error) {
    console.error("Ashir import error:", error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supplier = db
      .select()
      .from(suppliers)
      .where(sql`UPPER(${suppliers.code}) = 'ASHIR'`)
      .get();

    if (!supplier) {
      return NextResponse.json({
        exists: false,
        message: "Ashir supplier will be created on first import",
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
    console.error("Ashir GET error:", error);
    return NextResponse.json({ error: "Failed to get Ashir info" }, { status: 500 });
  }
}
