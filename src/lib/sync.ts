import { db } from "@/lib/db";
import {
  suppliers,
  exchangeRates,
  settings,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getConnector } from "@/lib/connectors";
import { calculateSupplierCost } from "@/lib/pricing";
import type { ApiConfig } from "@/types";

const OVERRIDE_KEY = "exchange_rate_override";
const STALE_MINUTES = 15;

function isRateStale(fetchedAt: string): boolean {
  return Date.now() - new Date(fetchedAt).getTime() > STALE_MINUTES * 60 * 1000;
}

export async function refreshExchangeRate(): Promise<number | null> {
  const override = db.select().from(settings).where(eq(settings.key, OVERRIDE_KEY)).get();
  if (override) {
    return JSON.parse(override.value).rate;
  }

  const [latest] = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .all();

  if (latest && !isRateStale(latest.fetchedAt)) {
    return latest.sellRate;
  }

  try {
    const response = await fetch("https://dolarapi.com/v1/dolares/oficial");
    if (!response.ok) return latest?.sellRate ?? null;
    const data = await response.json();
    const { compra, venta } = data;
    if (compra == null || venta == null) return latest?.sellRate ?? null;

    const [inserted] = await db
      .insert(exchangeRates)
      .values({ source: "oficial", buyRate: compra, sellRate: venta, fetchedAt: sql`(datetime('now'))` })
      .returning();

    return inserted.sellRate;
  } catch {
    return latest?.sellRate ?? null;
  }
}

function getCurrentExchangeRate(): number | null {
  const override = db.select().from(settings).where(eq(settings.key, OVERRIDE_KEY)).get();
  if (override) return JSON.parse(override.value).rate;
  const [latest] = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .all();
  return latest?.sellRate ?? null;
}

export interface SyncResult {
  catalogId: number;
  totalItems: number;
  linkedCount: number;
  exchangeRate: number | null;
  status: "completed" | "error";
  error?: string;
}

/**
 * Recalculate final_cost_ars for ALL supplier prices using the current exchange rate.
 * Optimized: single JOIN query + single batched transaction (was N+1 queries + N individual updates).
 */
export function recalculateAllSupplierPrices(): number {
  const exchangeRate = getCurrentExchangeRate();
  if (!exchangeRate) return 0;

  const sqlite = db.$client;

  // Single JOIN query instead of N+1 individual selects
  const rows = sqlite.prepare(`
    SELECT
      sp.id        AS price_id,
      sp.raw_price AS raw_price,
      sp.currency  AS currency,
      p.iva_rate              AS iva_rate,
      COALESCE(p.internal_tax_rate, 0) AS internal_tax_rate,
      s.tax_rate   AS tax_rate
    FROM supplier_prices sp
    INNER JOIN product_supplier_links psl ON sp.link_id = psl.id
    INNER JOIN products p ON p.id = psl.product_id
    INNER JOIN suppliers s ON s.id = psl.supplier_id
  `).all() as {
    price_id: number;
    raw_price: number;
    currency: string;
    iva_rate: number;
    internal_tax_rate: number;
    tax_rate: number;
  }[];

  if (rows.length === 0) return 0;

  const updateStmt = sqlite.prepare(
    `UPDATE supplier_prices SET final_cost_ars = ?, exchange_rate = ?, updated_at = datetime('now') WHERE id = ?`
  );

  // All updates in a single transaction — dramatically faster than N individual transactions
  sqlite.transaction(() => {
    for (const row of rows) {
      let finalCostArs: number;
      if (row.currency === "USD") {
        finalCostArs = calculateSupplierCost(
          row.raw_price,
          row.iva_rate,
          row.tax_rate,
          row.internal_tax_rate,
          exchangeRate
        );
      } else {
        finalCostArs = row.raw_price * (1 + row.tax_rate);
      }
      updateStmt.run(Math.round(finalCostArs * 100) / 100, row.currency === "USD" ? exchangeRate : null, row.price_id);
    }
  })();

  // Update precomputed best cost columns on products table
  const bestPriceRows = sqlite.prepare(`
    SELECT
      psl.product_id,
      sp.final_cost_ars,
      s.code as supplier_code,
      s.name as supplier_name,
      psl.supplier_stock_qty
    FROM product_supplier_links psl
    INNER JOIN supplier_prices sp ON sp.link_id = psl.id
    INNER JOIN suppliers s ON s.id = psl.supplier_id
    WHERE psl.is_active = 1 AND psl.supplier_stock_qty > 0
      AND sp.final_cost_ars = (
        SELECT MIN(sp2.final_cost_ars) FROM product_supplier_links psl2
        INNER JOIN supplier_prices sp2 ON sp2.link_id = psl2.id
        WHERE psl2.product_id = psl.product_id AND psl2.is_active = 1 AND psl2.supplier_stock_qty > 0
      )
    GROUP BY psl.product_id
  `).all() as { product_id: number; final_cost_ars: number; supplier_code: string; supplier_name: string; supplier_stock_qty: number }[];

  const updateBestStmt = sqlite.prepare(
    `UPDATE products SET best_cost_ars = ?, best_supplier_code = ?, best_supplier_name = ?, best_supplier_stock_qty = ? WHERE id = ?`
  );

  sqlite.transaction(() => {
    for (const row of bestPriceRows) {
      updateBestStmt.run(row.final_cost_ars, row.supplier_code, row.supplier_name, row.supplier_stock_qty, row.product_id);
    }
  })();

  // Clear best cost for products that now have no in-stock supplier
  sqlite.prepare(`
    UPDATE products SET best_cost_ars = NULL, best_supplier_code = NULL, best_supplier_name = NULL, best_supplier_stock_qty = 0
    WHERE best_cost_ars IS NOT NULL
      AND id NOT IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE is_active = 1 AND supplier_stock_qty > 0)
  `).run();

  return rows.length;
}

/**
 * Sync a single API supplier.
 * Optimized:
 * - Pre-loads all existing links + prices in 2 queries instead of N+1
 * - Processes items in batches of 250 within a single transaction per batch
 * - Yields to the Node.js event loop between batches so other requests can be served
 */
export async function syncSupplier(supplierId: number): Promise<SyncResult> {
  const supplier = db.select().from(suppliers).where(eq(suppliers.id, supplierId)).get();
  if (!supplier) throw new Error("Supplier not found");
  if (supplier.connectorType !== "api" || !supplier.apiConfig) {
    throw new Error("Supplier is not configured for API sync");
  }

  const apiConfig: ApiConfig = JSON.parse(supplier.apiConfig);
  const connector = getConnector(apiConfig.connectorId, apiConfig);

  // Network fetch — async, does NOT block the event loop
  const items = await connector.fetchCatalog();

  let exchangeRate: number | null = null;
  if (connector.getExchangeRate) {
    try { exchangeRate = await connector.getExchangeRate(); } catch {}
  }
  if (!exchangeRate) exchangeRate = getCurrentExchangeRate();

  const sqlite = db.$client;

  // ── Pre-load all existing links + product tax info in one query ──────────
  const existingLinks = sqlite.prepare(`
    SELECT
      psl.id, psl.product_id, psl.supplier_code, psl.supplier_stock_qty, psl.stock_locked,
      p.iva_rate, COALESCE(p.internal_tax_rate, 0) AS internal_tax_rate
    FROM product_supplier_links psl
    INNER JOIN products p ON p.id = psl.product_id
    WHERE psl.supplier_id = ? AND psl.is_active = 1
  `).all(supplierId) as {
    id: number;
    product_id: number;
    supplier_code: string;
    supplier_stock_qty: number;
    stock_locked: number;
    iva_rate: number;
    internal_tax_rate: number;
  }[];

  const linksByCode = new Map(existingLinks.map((l) => [l.supplier_code, l]));

  // ── Pre-load existing prices for all those links in one query ─────────────
  const linkIds = existingLinks.map((l) => l.id);
  const existingPrices: Map<number, { id: number; raw_price: number; currency: string; exchange_rate: number | null; final_cost_ars: number }> = new Map();

  if (linkIds.length > 0) {
    const placeholders = linkIds.map(() => "?").join(",");
    const priceRows = sqlite.prepare(
      `SELECT id, link_id, raw_price, currency, exchange_rate, final_cost_ars FROM supplier_prices WHERE link_id IN (${placeholders})`
    ).all(...linkIds) as { id: number; link_id: number; raw_price: number; currency: string; exchange_rate: number | null; final_cost_ars: number }[];
    for (const p of priceRows) existingPrices.set(p.link_id, p);
  }

  // ── Create catalog record ─────────────────────────────────────────────────
  const catalogResult = sqlite.prepare(
    `INSERT INTO supplier_catalogs (supplier_id, filename, row_count, status) VALUES (?, ?, ?, 'processing')`
  ).run(supplierId, `api-sync-${new Date().toISOString().slice(0, 10)}`, items.length);
  const catalogId = Number(catalogResult.lastInsertRowid);

  // ── Prepared statements (compiled once, reused for every row) ────────────
  const stmts = {
    insertCatalogItem: sqlite.prepare(
      `INSERT INTO supplier_catalog_items (catalog_id, supplier_code, description, price, currency, stock_available, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    updateCatalogItemLinked: sqlite.prepare(
      `UPDATE supplier_catalog_items SET linked_product_id = ?, match_confidence = 0.99 WHERE id = ?`
    ),
    updateProductTaxes: sqlite.prepare(
      `UPDATE products SET iva_rate = ?, internal_tax_rate = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    updateLinkStock: sqlite.prepare(
      `UPDATE product_supplier_links SET supplier_stock_qty = ? WHERE id = ?`
    ),
    updateProductStock: sqlite.prepare(
      `UPDATE products SET has_supplier_stock = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    insertPriceHistory: sqlite.prepare(
      `INSERT INTO price_history (link_id, raw_price, currency, exchange_rate, final_cost_ars) VALUES (?, ?, ?, ?, ?)`
    ),
    updatePrice: sqlite.prepare(
      `UPDATE supplier_prices SET raw_price = ?, currency = ?, exchange_rate = ?, final_cost_ars = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    insertPrice: sqlite.prepare(
      `INSERT INTO supplier_prices (link_id, raw_price, currency, exchange_rate, final_cost_ars) VALUES (?, ?, ?, ?, ?)`
    ),
  };

  let linkedCount = 0;
  // Track which supplier codes appeared in the API response with a valid price.
  // After processing all batches we zero out links for codes that were absent —
  // many supplier APIs (including PC Arts op 1004) omit out-of-stock products
  // entirely instead of returning them with stock: 0.
  const seenCodes = new Set<string>();

  // ── Process items in batches, yielding to event loop between each batch ──
  // This allows other HTTP requests to be handled between batches.
  const BATCH_SIZE = 250;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    // Yield to the event loop so pending requests can be processed
    await new Promise<void>((resolve) => setImmediate(resolve));

    const batch = items.slice(i, i + BATCH_SIZE);

    linkedCount += sqlite.transaction(() => {
      let batchLinked = 0;

      for (const item of batch) {
        // Insert catalog item
        const catalogItemResult = stmts.insertCatalogItem.run(
          catalogId,
          item.code,
          item.description,
          item.price,
          item.currency,
          item.stockAvailable ? 1 : 0,
          item.rawData ? JSON.stringify(item.rawData) : null
        );
        const catalogItemId = Number(catalogItemResult.lastInsertRowid);

        if (!item.code || item.price <= 0) continue;

        // Mark this code as seen so we don't zero it out after the loop
        seenCodes.add(item.code);

        const link = linksByCode.get(item.code);
        if (!link) continue;

        const rawData = (item.rawData || {}) as Record<string, unknown>;
        const itemIvaRate = typeof rawData.ivaRate === "number" ? rawData.ivaRate : null;
        const itemInternalTaxRate = typeof rawData.internalTaxRate === "number" ? rawData.internalTaxRate : null;

        const stockObj =
          rawData.stock && typeof rawData.stock === "object"
            ? (rawData.stock as Record<string, number>)
            : null;
        const itemStockQty = stockObj
          ? (stockObj.nb ?? stockObj.caba ?? stockObj.lug ?? stockObj.elit ?? 0)
          : typeof rawData.stockQty === "number"
          ? rawData.stockQty
          : 0;

        // Update product tax rates only if they changed
        if (
          itemIvaRate !== null &&
          (link.iva_rate !== itemIvaRate || link.internal_tax_rate !== (itemInternalTaxRate ?? 0))
        ) {
          stmts.updateProductTaxes.run(itemIvaRate, itemInternalTaxRate ?? 0, link.product_id);
          link.iva_rate = itemIvaRate;
          link.internal_tax_rate = itemInternalTaxRate ?? 0;
        }

        stmts.updateLinkStock.run(itemStockQty, link.id);
        stmts.updateProductStock.run(item.stockAvailable ? 1 : 0, link.product_id);

        const effectiveIvaRate = itemIvaRate ?? link.iva_rate;
        const effectiveInternalTaxRate = itemInternalTaxRate ?? link.internal_tax_rate;

        let finalCostArs: number;
        if (item.currency === "USD" && exchangeRate) {
          finalCostArs = calculateSupplierCost(
            item.price,
            effectiveIvaRate,
            supplier.taxRate,
            effectiveInternalTaxRate,
            exchangeRate
          );
        } else {
          finalCostArs = item.price * (1 + supplier.taxRate);
        }
        finalCostArs = Math.round(finalCostArs * 100) / 100;

        const existingPrice = existingPrices.get(link.id);
        if (existingPrice) {
          // Archive old price first
          stmts.insertPriceHistory.run(
            link.id,
            existingPrice.raw_price,
            existingPrice.currency,
            existingPrice.exchange_rate,
            existingPrice.final_cost_ars
          );
          stmts.updatePrice.run(
            item.price,
            item.currency,
            item.currency === "USD" ? exchangeRate : null,
            finalCostArs,
            existingPrice.id
          );
          // Update in-memory cache so subsequent iterations see the new price
          existingPrice.raw_price = item.price;
          existingPrice.currency = item.currency;
          existingPrice.exchange_rate = item.currency === "USD" ? exchangeRate : null;
          existingPrice.final_cost_ars = finalCostArs;
        } else {
          const newPriceId = Number(
            stmts.insertPrice.run(
              link.id,
              item.price,
              item.currency,
              item.currency === "USD" ? exchangeRate : null,
              finalCostArs
            ).lastInsertRowid
          );
          existingPrices.set(link.id, {
            id: newPriceId,
            raw_price: item.price,
            currency: item.currency,
            exchange_rate: item.currency === "USD" ? exchangeRate : null,
            final_cost_ars: finalCostArs,
          });
        }

        // Record current price in history
        stmts.insertPriceHistory.run(
          link.id,
          item.price,
          item.currency,
          item.currency === "USD" ? exchangeRate : null,
          finalCostArs
        );

        stmts.updateCatalogItemLinked.run(link.product_id, catalogItemId);
        batchLinked++;
      }

      return batchLinked;
    })();
  }

  sqlite.prepare(
    `UPDATE supplier_catalogs SET status = 'completed', linked_count = ? WHERE id = ?`
  ).run(linkedCount, catalogId);

  // ── Zero out links whose supplier_code was absent from the API response ──────────────
  // Supplier APIs often omit out-of-stock products instead of returning them with stock: 0.
  // Without this step those links retain stale supplier_stock_qty values and the products
  // keep appearing as available in WooCommerce.
  const unseenLinks = existingLinks.filter((l) => !seenCodes.has(l.supplier_code));
  if (unseenLinks.length > 0) {
    sqlite.transaction(() => {
      for (const link of unseenLinks) {
        stmts.updateLinkStock.run(0, link.id);
      }
    })();
  }

  // ── Step 1: Refresh best_cost_ars for the products linked to this supplier ──────────
  // syncSupplier() updates supplier_prices.final_cost_ars per item but does NOT update
  // products.best_cost_ars. The cron/sync smart detection uses best_cost_ars to compute
  // the expected client price, so we must update it here before running change detection.
  //
  // Update best cost for products that now have an in-stock option via this supplier.
  sqlite.prepare(`
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

  // Clear best cost for products that now have NO in-stock supplier (because this sync
  // may have zeroed out stock that used to be the best option).
  sqlite.prepare(`
    UPDATE products SET best_cost_ars = NULL, best_supplier_code = NULL, best_supplier_name = NULL, best_supplier_stock_qty = 0
    WHERE best_cost_ars IS NOT NULL
      AND id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ? AND is_active = 1)
      AND id NOT IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE is_active = 1 AND supplier_stock_qty > 0)
  `).run(supplierId);

  // ── Step 2: Smart change detection — mark pending only products that actually changed ──
  // Same logic as cron/sync: compare computed client price and total stock vs last synced values.
  // This ensures that if a catalog import didn't change price or stock, nothing gets marked.
  sqlite.prepare(`
    UPDATE products
    SET woo_sync_pending = 1
    WHERE woo_sync_pending = 0
      AND woocommerce_id IS NOT NULL
      AND id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ? AND is_active = 1)
      AND (
        -- Never been synced (use woo_last_synced_at — NOT regular_price IS NULL,
        -- because no-price products also store NULL after sync and would loop forever)
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

  return { catalogId, totalItems: items.length, linkedCount, exchangeRate, status: "completed" };
}
