import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WOO_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  computeSyncPayload,
  pushToWooCommerceBatch,
  recordBlockedSync,
} from "@/lib/woo-sync-utils";
import type { DB } from "@/lib/db";

const BATCH_SIZE = 200;        // products per cron run — 2 WC batch calls ~10-15s, safe within 30s
const WC_BATCH_SIZE = 100;     // WC batch API items per call
const PAYLOAD_CONCURRENCY = 5; // parallel DB payload computations

/**
 * POST /api/cron/woo-sync
 * Self-contained sync cron: detects changes AND pushes to WooCommerce in one pass.
 *
 * Before processing, runs the same change-detection SQL as cron/sync so this cron
 * works independently — no dependency on cron/sync having run first.
 * cron/sync is still needed for exchange-rate updates and price recalculation.
 *
 * With BATCH_SIZE=200: processes 200 products in ~2 WC batch calls (~6-10 seconds total).
 * At 1-min schedule: handles up to 12,000 price/stock changes per hour automatically.
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_WOO_MSG, demo: true });
  }
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = process.env.WOO_URL?.replace(/\/+$/, "");
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY) {
    return NextResponse.json({ error: "WooCommerce not configured — skipping" });
  }

  // ── Step 0: Self-contained change detection ──
  // Mark any products whose computed price/stock differs from what was last synced to WC.
  // Same SQL as cron/sync — ensures this cron works even if cron/sync didn't run recently.
  // best_cost_ars is kept current by: cron/sync (on rate change) and syncSupplier() (on catalog import).
  const sqlite = (db as DB).$client;
  const detectionResult = sqlite.prepare(`
    UPDATE products
    SET woo_sync_pending = 1
    WHERE woo_sync_pending = 0
      AND woocommerce_id IS NOT NULL
      AND (
        -- Never synced to WC before
        woo_last_synced_at IS NULL

        -- Regular price changed (roundToNine comparison — avoids float .5 boundary oscillation)
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
  const newlyMarked = (detectionResult as { changes: number }).changes;
  console.log(`[cron/woo-sync] Change detection marked ${newlyMarked} new products as pending`);

  // Process manual overrides (wooManualPrivate) first, then oldest-synced, then by id.
  // Exclude products with a pending blocked-sync entry — they require manual approval first.
  const pending = (sqlite.prepare(`
    SELECT id FROM products
    WHERE woo_sync_pending = 1
      AND woocommerce_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM woo_sync_blocked
        WHERE product_id = products.id AND status = 'pending'
      )
    ORDER BY woo_manual_private DESC, woo_last_synced_at ASC NULLS FIRST, id ASC
    LIMIT ${BATCH_SIZE}
  `).all() as { id: number }[]);

  if (pending.length === 0) {
    return NextResponse.json({ newlyMarked, synced: 0, blocked: 0, errors: 0, message: "Nothing pending" });
  }

  // ── Step 1: Compute all payloads in parallel (DB only, no WC calls) ──
  const payloadResults: Array<{ productId: number; payload: Awaited<ReturnType<typeof computeSyncPayload>> }> = [];
  for (let i = 0; i < pending.length; i += PAYLOAD_CONCURRENCY) {
    const slice = pending.slice(i, i + PAYLOAD_CONCURRENCY);
    const results = await Promise.all(slice.map(({ id }) => computeSyncPayload(id)));
    for (let j = 0; j < slice.length; j++) {
      payloadResults.push({ productId: slice[j].id, payload: results[j] });
    }
  }

  // ── Step 2: Categorize ──
  let blocked = 0;
  const toSync: Array<{
    productId: number;
    wooId: number;
    productName: string;
    data: Record<string, unknown>;
    regularPrice: number | null;
    offerPrice: number | null;
    stockQty: number;
    prevRegularPrice: number | null;
    prevOfferPrice: number | null;
    prevStockQty: number | null;
  }> = [];

  const errors: { id: number; error: string }[] = [];

  for (const { productId, payload } of payloadResults) {
    if (!payload) {
      await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, productId));
      continue;
    }
    if (payload.safeguard.blocked) {
      await recordBlockedSync(
        productId, payload.wooId, payload.productName,
        payload.safeguard.reason!, payload.safeguard.newPrice ?? null, payload.safeguard.oldPrice ?? null,
        payload.data
      );
      await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, productId));
      blocked++;
      console.log(`[cron/woo-sync] Blocked product ${productId}: ${payload.safeguard.reason}`);
      continue;
    }
    toSync.push({
      productId,
      wooId: payload.wooId,
      productName: payload.productName,
      data: payload.data,
      regularPrice: payload.regularPrice,
      offerPrice: payload.offerPrice,
      stockQty: payload.stockQty,
      prevRegularPrice: payload.prevRegularPrice,
      prevOfferPrice: payload.prevOfferPrice,
      prevStockQty: payload.prevStockQty,
    });
  }

  // ── Step 3: WC batch calls (chunks of WC_BATCH_SIZE) ──
  let synced = 0;
  const now = new Date().toISOString();

  for (let i = 0; i < toSync.length; i += WC_BATCH_SIZE) {
    const chunk = toSync.slice(i, i + WC_BATCH_SIZE);
    const batchResults = await pushToWooCommerceBatch(
      chunk.map(({ wooId, data }) => ({ wooId, data }))
    );

    for (const item of chunk) {
      const result = batchResults.find((r) => r.wooId === item.wooId);
      if (result?.ok) {
        await db.update(products).set({
          wooSyncPending: false,
          wooSyncedRegularPrice: item.regularPrice,
          wooSyncedOfferPrice: item.offerPrice,
          wooSyncedStockQty: item.stockQty,
          wooLastSyncedAt: now,
        }).where(eq(products.id, item.productId));
        sqlite.prepare(
          `INSERT INTO woo_sync_log (panel_id, woo_id, product_name, source, regular_price, offer_price, stock_qty, prev_regular_price, prev_offer_price, prev_stock_qty, synced_at)
           VALUES (?, ?, ?, 'push', ?, ?, ?, ?, ?, ?, ?)`
        ).run(item.productId, item.wooId, item.productName, item.regularPrice ?? null, item.offerPrice ?? null, item.stockQty, item.prevRegularPrice ?? null, item.prevOfferPrice ?? null, item.prevStockQty ?? null, now);
        synced++;
      } else if (result?.error?.includes("404")) {
        await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, item.productId));
      } else {
        errors.push({ id: item.productId, error: result?.error ?? "Unknown error" });
        // keep wooSyncPending=true — will retry next run
      }
    }
  }

  console.log(`[cron/woo-sync] Done: synced=${synced}, blocked=${blocked}, errors=${errors.length}`);

  return NextResponse.json({
    newlyMarked,
    synced,
    blocked,
    errors: errors.length,
    errorDetails: errors,
    processed: pending.length,
    timestamp: new Date().toISOString(),
  });
}
