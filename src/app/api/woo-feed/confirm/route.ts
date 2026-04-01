import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { DB } from "@/lib/db";

interface UpdateEntry {
  woo_id: number;
  regular_price: string | null;
  offer_price: string | null;
  stock_qty: number;
}

/**
 * POST /api/woo-feed/confirm
 *
 * Called by the WordPress pull-sync script after it successfully updates products.
 * Marks products as synced, records what was pushed, and writes to woo_sync_log.
 *
 * Body: { updates: [{ woo_id, regular_price, offer_price, stock_qty }] }
 * Auth: X-Panel-Sync-Secret header
 */
export async function POST(request: NextRequest) {
  const syncSecret = request.headers.get("x-panel-sync-secret");
  if (!syncSecret || syncSecret !== process.env.WOO_SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { updates?: UpdateEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ confirmed: 0 });
  }

  // Batch-lookup product names/ids for log entries
  const wooIds = updates.map((u) => u.woo_id);
  const panelProducts = await db
    .select({ id: products.id, name: products.name, woocommerceId: products.woocommerceId })
    .from(products)
    .where(inArray(products.woocommerceId, wooIds));

  const byWooId = new Map(panelProducts.map((p) => [p.woocommerceId!, p]));

  const now = new Date().toISOString();
  const sqlite = (db as DB).$client;
  const logInsert = sqlite.prepare(
    `INSERT INTO woo_sync_log (panel_id, woo_id, product_name, source, regular_price, offer_price, stock_qty, synced_at)
     VALUES (?, ?, ?, 'pull', ?, ?, ?, ?)`
  );

  let confirmed = 0;

  const tx = sqlite.transaction(() => {
    for (const update of updates) {
      const panel = byWooId.get(update.woo_id);
      if (!panel) continue;

      const regularPrice = update.regular_price ? parseFloat(update.regular_price) : null;
      const offerPrice = update.offer_price ? parseFloat(update.offer_price) : null;

      sqlite.prepare(
        `UPDATE products SET
           woo_sync_pending = 0,
           woo_synced_regular_price = ?,
           woo_synced_offer_price = ?,
           woo_synced_stock_qty = ?,
           woo_last_synced_at = ?
         WHERE woocommerce_id = ?`
      ).run(regularPrice ?? null, offerPrice ?? null, update.stock_qty, now, update.woo_id);

      logInsert.run(
        panel.id,
        update.woo_id,
        panel.name,
        regularPrice ?? null,
        offerPrice ?? null,
        update.stock_qty,
        now
      );

      confirmed++;
    }
  });

  tx();

  return NextResponse.json({ confirmed, timestamp: now });
}
