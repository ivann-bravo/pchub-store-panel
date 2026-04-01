import { db } from "@/lib/db";
import {
  suppliers,
  productSupplierLinks,
  supplierPrices,
  priceHistory,
  products,
  exchangeRates,
  settings,
} from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  PolytechConnector,
  POLYTECH_BASE_URL,
  type PolytechSearchItem,
} from "@/lib/connectors/polytech";
import { calculateSupplierCost } from "@/lib/pricing";

const CONCURRENCY = 3; // llamadas simultáneas a la API

function getExchangeRate(): number {
  const setting = db
    .select()
    .from(settings)
    .where(eq(settings.key, "exchange_rate_override"))
    .get();
  if (setting) {
    try {
      const val = JSON.parse(setting.value);
      if (typeof val === "number" && val > 0) return val;
    } catch {}
  }
  const rate = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .get();
  return rate?.sellRate || 1;
}

/**
 * Ejecuta `fn` sobre todos los items con un máximo de `concurrency` promesas
 * corriendo en paralelo al mismo tiempo.
 */
async function runConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export interface PolytechSyncResult {
  status: "completed" | "error";
  totalItems: number;
  linkedCount: number;
  exchangeRate: number | null;
  errors?: string[];
  message?: string;
}

export async function syncPolytechSupplier(
  supplierId: number
): Promise<PolytechSyncResult> {
  const supplier = db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, supplierId))
    .get();

  if (!supplier) throw new Error("Supplier not found");
  if (!supplier.apiConfig) throw new Error("Polytech: apiConfig missing");

  const cfg = JSON.parse(supplier.apiConfig);
  const connector = new PolytechConnector(
    cfg.username || "",
    cfg.baseUrl || POLYTECH_BASE_URL
  );

  const iibbRate = supplier.taxRate || 0;
  const xRate = getExchangeRate();

  // ── Cargar todos los links vinculados a este proveedor ───────────────────
  const links = db.$client
    .prepare(
      `SELECT psl.id, psl.supplier_code, psl.product_id,
              p.iva_rate, p.internal_tax_rate
       FROM product_supplier_links psl
       INNER JOIN products p ON p.id = psl.product_id
       WHERE psl.supplier_id = ? AND psl.is_active = 1
         AND psl.supplier_code IS NOT NULL AND psl.supplier_code != ''`
    )
    .all(supplierId) as {
    id: number;
    supplier_code: string;
    product_id: number;
    iva_rate: number;
    internal_tax_rate: number;
  }[];

  if (links.length === 0) {
    return {
      status: "completed",
      totalItems: 0,
      linkedCount: 0,
      exchangeRate: xRate,
      message: "No hay productos vinculados a Polytech",
    };
  }

  let linkedCount = 0;
  const errors: string[] = [];

  // ── Buscar cada producto en paralelo (CONCURRENCY simultáneos) ───────────
  type LinkResult = { link: (typeof links)[0]; item: PolytechSearchItem | null; error?: string };

  const linkResults = await runConcurrent<(typeof links)[0], LinkResult>(
    links,
    CONCURRENCY,
    async (link) => {
      try {
        const result = await connector.search(link.supplier_code, 1);
        const match = result.items.find((i) => i.sourceId === link.supplier_code) ?? null;
        return { link, item: match };
      } catch (err) {
        return {
          link,
          item: null,
          error: `${link.supplier_code}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  );

  // ── Procesar resultados y actualizar BD ──────────────────────────────────
  for (const { link, item, error } of linkResults) {
    if (error) {
      errors.push(error);
      continue;
    }
    if (!item) {
      // Product not found in Polytech API — most likely discontinued or out of stock.
      // Zero out its stock so it doesn't show as available in our catalog or WC.
      db.update(productSupplierLinks)
        .set({ supplierStockQty: 0 })
        .where(eq(productSupplierLinks.id, link.id))
        .run();
      continue;
    }

    try {
      // Actualizar stock en el link
      db.update(productSupplierLinks)
        .set({ supplierStockQty: item.stock })
        .where(eq(productSupplierLinks.id, link.id))
        .run();

      // Actualizar IVA del producto si cambió
      if (Math.abs(link.iva_rate - item.ivaRate) > 0.001) {
        db.update(products)
          .set({ ivaRate: item.ivaRate, updatedAt: new Date().toISOString() })
          .where(eq(products.id, link.product_id))
          .run();
      }

      const finalCostArs = calculateSupplierCost(
        item.precioSinIva,
        item.ivaRate,
        iibbRate,
        link.internal_tax_rate || 0,
        xRate
      );

      // Actualizar precio (guardando historial)
      const existingPrice = db
        .select()
        .from(supplierPrices)
        .where(eq(supplierPrices.linkId, link.id))
        .get();

      if (existingPrice) {
        db.insert(priceHistory)
          .values({
            linkId: link.id,
            rawPrice: existingPrice.rawPrice,
            currency: existingPrice.currency,
            exchangeRate: existingPrice.exchangeRate,
            finalCostArs: existingPrice.finalCostArs,
          })
          .run();
        db.update(supplierPrices)
          .set({
            rawPrice: item.precioSinIva,
            currency: "USD",
            exchangeRate: xRate,
            finalCostArs,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(supplierPrices.id, existingPrice.id))
          .run();
      } else {
        db.insert(supplierPrices)
          .values({
            linkId: link.id,
            rawPrice: item.precioSinIva,
            currency: "USD",
            exchangeRate: xRate,
            finalCostArs,
          })
          .run();
      }

      db.insert(priceHistory)
        .values({
          linkId: link.id,
          rawPrice: item.precioSinIva,
          currency: "USD",
          exchangeRate: xRate,
          finalCostArs,
        })
        .run();

      // Actualizar flag de stock en el producto
      db.update(products)
        .set({
          hasSupplierStock: item.stockAvailable,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(products.id, link.product_id))
        .run();

      linkedCount++;
    } catch (err) {
      errors.push(
        `${item.sourceId}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Update supplier_catalog_items with API-synced prices and stock ──────────
  // Catalog items are originally populated from the Excel import and never updated
  // by this function, causing the catalog view to show stale Excel prices even
  // though supplier_prices (used for actual pricing) is already correct.
  const successfulResults = linkResults.filter(
    (r): r is { link: (typeof links)[0]; item: PolytechSearchItem; error: undefined } =>
      r.item !== null && !r.error
  );
  if (successfulResults.length > 0) {
    const updateCatalogItem = db.$client.prepare(`
      UPDATE supplier_catalog_items
      SET price = ?, stock_available = ?, raw_data = ?
      WHERE supplier_code = ?
        AND catalog_id IN (SELECT id FROM supplier_catalogs WHERE supplier_id = ?)
    `);
    for (const { link, item } of successfulResults) {
      updateCatalogItem.run(
        item.precioSinIva,
        item.stockAvailable ? 1 : 0,
        JSON.stringify(item.rawData),
        link.supplier_code,
        supplierId
      );
    }
  }

  // Zero out catalog stock for products not found in the API (discontinued / no longer available)
  const notFoundResults = linkResults.filter((r) => r.item === null && !r.error);
  if (notFoundResults.length > 0) {
    const zeroCatalogStock = db.$client.prepare(`
      UPDATE supplier_catalog_items
      SET stock_available = 0
      WHERE supplier_code = ?
        AND catalog_id IN (SELECT id FROM supplier_catalogs WHERE supplier_id = ?)
    `);
    for (const { link } of notFoundResults) {
      zeroCatalogStock.run(link.supplier_code, supplierId);
    }
  }

  // ── Refresh best_cost_ars for products linked to this supplier ───────────────
  // supplier_prices.final_cost_ars was just updated above but products.best_cost_ars
  // (which cron/woo-sync uses for change detection) is a cached column — must refresh
  // it here so price changes from this API sync are picked up by the next woo-sync run.
  // Identical SQL to syncSupplier() in sync.ts.
  db.$client.prepare(`
    UPDATE products
    SET
      best_cost_ars = (
        SELECT MIN(sp.final_cost_ars)
        FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
      ),
      best_supplier_code = (
        SELECT s.code FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        JOIN suppliers s ON s.id = psl.supplier_id
        WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
        ORDER BY sp.final_cost_ars ASC LIMIT 1
      ),
      best_supplier_name = (
        SELECT s.name FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        JOIN suppliers s ON s.id = psl.supplier_id
        WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
        ORDER BY sp.final_cost_ars ASC LIMIT 1
      ),
      best_supplier_stock_qty = COALESCE((
        SELECT psl.supplier_stock_qty FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
        ORDER BY sp.final_cost_ars ASC LIMIT 1
      ), 0)
    WHERE id IN (
      SELECT DISTINCT product_id FROM product_supplier_links
      WHERE supplier_id = ? AND is_active = 1
    )
  `).run(supplierId);

  // Clear best cost for products that lost all in-stock suppliers after this sync
  db.$client.prepare(`
    UPDATE products
    SET best_cost_ars = NULL, best_supplier_code = NULL, best_supplier_name = NULL, best_supplier_stock_qty = 0
    WHERE best_cost_ars IS NOT NULL
      AND id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ? AND is_active = 1)
      AND id NOT IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE is_active = 1 AND supplier_stock_qty > 0)
  `).run(supplierId);

  // ── Smart change detection: mark woo_sync_pending for changed products ───────
  // Same SQL as cron/woo-sync and syncSupplier() — only marks products where the
  // computed price or total stock actually changed vs what was last pushed to WC.
  db.$client.prepare(`
    UPDATE products
    SET woo_sync_pending = 1
    WHERE woo_sync_pending = 0
      AND woocommerce_id IS NOT NULL
      AND id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ? AND is_active = 1)
      AND (
        woo_last_synced_at IS NULL
        -- Regular price changed (roundToNine comparison — avoids float .5 boundary oscillation)
        OR COALESCE(
          CAST(CEIL((CEIL(COALESCE(own_price_regular,
            CASE WHEN best_cost_ars IS NOT NULL THEN best_cost_ars * markup_regular ELSE NULL END
          )) - 9.0) / 10.0) AS INTEGER) * 10 + 9
        , 0) != COALESCE(
          CAST(CEIL((CEIL(woo_synced_regular_price) - 9.0) / 10.0) AS INTEGER) * 10 + 9
        , 0)
        -- Offer price changed
        OR COALESCE(
          CAST(CEIL((CEIL(COALESCE(own_price_offer,
            CASE WHEN best_cost_ars IS NOT NULL AND markup_offer IS NOT NULL
                 THEN best_cost_ars * markup_offer ELSE NULL END
          )) - 9.0) / 10.0) AS INTEGER) * 10 + 9
        , 0) != COALESCE(
          CAST(CEIL((CEIL(woo_synced_offer_price) - 9.0) / 10.0) AS INTEGER) * 10 + 9
        , 0)
        -- Stock changed: use best-price supplier stock (mirrors computeSyncPayload logic).
        -- local_stock takes priority; otherwise the cheapest active supplier with stock+price.
        OR (
          CASE
            WHEN COALESCE(local_stock, 0) > 0
            THEN COALESCE(local_stock, 0)
            ELSE COALESCE((
              SELECT psl2.supplier_stock_qty
              FROM product_supplier_links psl2
              JOIN supplier_prices sp2 ON sp2.link_id = psl2.id
              WHERE psl2.product_id = products.id
                AND psl2.is_active = 1
                AND COALESCE(psl2.supplier_stock_qty, 0) > 0
                AND sp2.final_cost_ars IS NOT NULL
              ORDER BY sp2.final_cost_ars ASC
              LIMIT 1
            ), 0)
          END
        ) != COALESCE(woo_synced_stock_qty, -1)
      )
  `).run(supplierId);

  return {
    status: "completed",
    totalItems: links.length,
    linkedCount,
    exchangeRate: xRate,
    errors,
  };
}
