import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeRates } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { recalculateAllSupplierPrices } from "@/lib/sync";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { refreshPurchaseOrderStockAlerts } from "@/lib/purchase-stock-alerts";
import type { DB } from "@/lib/db";

function runCleanup() {
  // Delete price history older than 14 days
  const ph = db.run(sql`DELETE FROM price_history WHERE recorded_at < datetime('now', '-14 days')`);
  // Delete product price history older than 14 days
  const pph = db.run(sql`DELETE FROM product_price_history WHERE recorded_at < datetime('now', '-14 days')`);
  // Delete exchange rates older than 90 days
  const er = db.run(sql`DELETE FROM exchange_rates WHERE fetched_at < datetime('now', '-90 days')`);
  // Delete woo sync log older than 7 days
  db.run(sql`DELETE FROM woo_sync_log WHERE synced_at < datetime('now', '-7 days')`);
  // Keep only the 3 most recent catalogs per supplier (cascade deletes catalog items + rawData JSON)
  const cat = db.run(sql`
    DELETE FROM supplier_catalogs
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY imported_at DESC) AS rn
        FROM supplier_catalogs
      ) WHERE rn <= 3
    )
  `);
  return {
    priceHistoryDeleted: (ph as { changes: number }).changes ?? 0,
    productPriceHistoryDeleted: (pph as { changes: number }).changes ?? 0,
    exchangeRatesDeleted: (er as { changes: number }).changes ?? 0,
    catalogsDeleted: (cat as { changes: number }).changes ?? 0,
  };
}

const RECALC_THRESHOLD = 0.005; // 0.5%

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch fresh exchange rate from dolarapi
    const apiResponse = await fetch("https://dolarapi.com/v1/dolares/oficial");
    if (!apiResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch exchange rate from dolarapi.com" },
        { status: 502 }
      );
    }
    const data = await apiResponse.json();
    const { compra, venta } = data as { compra: number; venta: number };

    // 2. Get previous rate before inserting
    const [prevRate] = await db
      .select()
      .from(exchangeRates)
      .orderBy(desc(exchangeRates.fetchedAt))
      .limit(1);

    // 3. Insert new rate
    const [newRate] = await db
      .insert(exchangeRates)
      .values({
        source: "oficial",
        buyRate: compra,
        sellRate: venta,
        fetchedAt: sql`(datetime('now'))`,
      })
      .returning();

    // 4. Decide whether to recalculate
    let rateChangePct = 0;
    if (prevRate) {
      rateChangePct = Math.abs(newRate.sellRate - prevRate.sellRate) / prevRate.sellRate;
    }
    const shouldRecalc = !prevRate || rateChangePct > RECALC_THRESHOLD;

    let recalcCount = 0;
    if (shouldRecalc) {
      recalcCount = recalculateAllSupplierPrices();
      refreshAllCombos();
      refreshAllBuscador();
      console.log(
        `[cron/sync] Recalculated ${recalcCount} prices. ` +
        `Rate: ${prevRate?.sellRate ?? "N/A"} → ${newRate.sellRate} ` +
        `(${(rateChangePct * 100).toFixed(3)}%)`
      );
    } else {
      console.log(
        `[cron/sync] Rate unchanged (${(rateChangePct * 100).toFixed(3)}%), skipping recalculation.`
      );
    }

    // Smart change detection: mark as pending only products where the computed values
    // (regular price, offer price, or total stock) differ from what was last pushed to WC.
    // This avoids unnecessary WC API calls for products that haven't actually changed.
    //
    // Regular price: COALESCE(own_price_regular, best_cost_ars × markup_regular)
    // Offer price:   COALESCE(own_price_offer,   best_cost_ars × markup_offer)
    // Total stock:   local_stock + SUM(active supplier_stock_qty)
    //
    // best_cost_ars is always up-to-date:
    //  - If rate changed: recalculateAllSupplierPrices() just refreshed it for all products.
    //  - If rate unchanged: best_cost_ars reflects the last time prices were calculated.
    //  - For API supplier syncs: syncSupplier() updates best_cost_ars for its products
    //    before running its own copy of this same detection SQL.
    // Stock uses a live subquery on supplier_stock_qty so it's always current.
    const sqlite = (db as DB).$client;
    const pendingResult = sqlite.prepare(`
      UPDATE products
      SET woo_sync_pending = 1
      WHERE woo_sync_pending = 0
        AND woocommerce_id IS NOT NULL
        AND (
          -- Never been synced to WC before (use woo_last_synced_at, NOT regular_price,
          -- because products with no price/stock have regular_price=NULL after sync too
          -- and would be re-marked on every cron run — causing an infinite loop)
          woo_last_synced_at IS NULL

          -- Regular price changed: compare using roundToNine (same function applied to WC payloads).
          -- Using ROUND() was wrong — it's sensitive to floating-point at .5 boundaries, causing
          -- best_cost_ars × markup_regular to alternate between N and N+1 in JS vs SQLite even
          -- when the actual WC price (roundToNine) never changes.
          -- SQL roundToNine(x) = CAST(CEIL((CEIL(x) - 9.0) / 10.0) AS INTEGER) * 10 + 9
          OR COALESCE(
            CAST(CEIL((CEIL(COALESCE(own_price_regular,
              CASE WHEN best_cost_ars IS NOT NULL
                   THEN best_cost_ars * markup_regular
                   ELSE NULL END
            )) - 9.0) / 10.0) AS INTEGER) * 10 + 9
          , 0) != COALESCE(
            CAST(CEIL((CEIL(woo_synced_regular_price) - 9.0) / 10.0) AS INTEGER) * 10 + 9
          , 0)

          -- Offer price changed
          OR COALESCE(
            CAST(CEIL((CEIL(COALESCE(own_price_offer,
              CASE WHEN best_cost_ars IS NOT NULL AND markup_offer IS NOT NULL
                   THEN best_cost_ars * markup_offer
                   ELSE NULL END
            )) - 9.0) / 10.0) AS INTEGER) * 10 + 9
          , 0) != COALESCE(
            CAST(CEIL((CEIL(woo_synced_offer_price) - 9.0) / 10.0) AS INTEGER) * 10 + 9
          , 0)

          -- Stock changed: use best-price supplier stock (mirrors computeSyncPayload logic).
          -- local_stock takes priority; otherwise the cheapest active supplier with stock+price.
          -- Using SUM(all suppliers) was wrong — it never matched woo_synced_stock_qty (which
          -- stores only the best supplier's qty) and caused every product to re-sync forever.
          OR (
            CASE
              WHEN COALESCE(local_stock, 0) > 0
              THEN COALESCE(local_stock, 0)
              ELSE COALESCE((
                SELECT psl.supplier_stock_qty
                FROM product_supplier_links psl
                JOIN supplier_prices sp ON sp.link_id = psl.id
                WHERE psl.product_id = products.id
                  AND psl.is_active = 1
                  AND COALESCE(psl.supplier_stock_qty, 0) > 0
                  AND sp.final_cost_ars IS NOT NULL
                ORDER BY sp.final_cost_ars ASC
                LIMIT 1
              ), 0)
            END
          ) != COALESCE(woo_synced_stock_qty, -1)
        )
    `).run();
    const wooPendingMarked = (pendingResult as { changes: number }).changes;

    // 5. Refresh stock alert status for open purchase order items
    const stockAlertsUpdated = refreshPurchaseOrderStockAlerts();
    console.log(`[cron/sync] Purchase order stock alerts updated: ${stockAlertsUpdated} items`);

    // 6. Run data retention cleanup
    const cleanup = runCleanup();
    console.log(`[cron/sync] Cleanup: priceHistory -${cleanup.priceHistoryDeleted}, productPriceHistory -${cleanup.productPriceHistoryDeleted}, exchangeRates -${cleanup.exchangeRatesDeleted}, catalogs -${cleanup.catalogsDeleted}`);

    return NextResponse.json({
      success: true,
      exchangeRate: newRate.sellRate,
      previousRate: prevRate?.sellRate ?? null,
      rateChangePct: `${(rateChangePct * 100).toFixed(3)}%`,
      recalculated: shouldRecalc,
      recalcCount,
      wooPendingMarked,
      stockAlertsUpdated,
      cleanup,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[cron/sync] error:", error);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
