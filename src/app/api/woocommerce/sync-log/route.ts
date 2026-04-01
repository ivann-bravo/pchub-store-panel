import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";

/**
 * GET /api/woocommerce/sync-log
 * Returns paginated woo sync log with optional filters.
 * Params: page, limit, product (name search), date (7d|today|yesterday), change_type (price|stock)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page    = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit   = Math.min(100, Math.max(10, parseInt(searchParams.get("limit") ?? "50")));
  const product = searchParams.get("product")?.trim() ?? "";
  const date    = searchParams.get("date") ?? "7d";
  const changeType = searchParams.get("change_type") ?? "all";
  const offset  = (page - 1) * limit;

  const sqlite = (db as DB).$client;

  const dateFilter = date === "today"
    ? `AND synced_at >= date('now')`
    : date === "yesterday"
    ? `AND synced_at >= date('now', '-1 day') AND synced_at < date('now')`
    : `AND synced_at >= datetime('now', '-7 days')`;

  const nameFilter = product
    ? `AND product_name LIKE '%' || ? || '%'`
    : "";

  // change_type filter: derived from comparing current vs prev values
  const priceChanged = `ABS(ROUND(COALESCE(regular_price,0)) - ROUND(COALESCE(prev_regular_price,0))) > 0`;
  const stockChanged = `COALESCE(stock_qty,0) != COALESCE(prev_stock_qty,-1)`;

  let changeFilter = "";
  if (changeType === "price") {
    changeFilter = `AND (prev_regular_price IS NULL OR ${priceChanged})`;
  } else if (changeType === "stock") {
    changeFilter = `AND (prev_stock_qty IS NULL OR ${stockChanged})`;
  }

  const params: unknown[] = [];
  if (product) params.push(product);

  const countParams = [...params];
  const total = (sqlite.prepare(
    `SELECT COUNT(*) as n FROM woo_sync_log
     WHERE 1=1 ${dateFilter} ${nameFilter} ${changeFilter}`
  ).get(...countParams) as { n: number }).n;

  const rowParams = [...params, limit, offset];
  const items = sqlite.prepare(
    `SELECT id, panel_id, woo_id, product_name, regular_price, offer_price, stock_qty,
            prev_regular_price, prev_offer_price, prev_stock_qty, synced_at
     FROM woo_sync_log
     WHERE 1=1 ${dateFilter} ${nameFilter} ${changeFilter}
     ORDER BY synced_at DESC
     LIMIT ? OFFSET ?`
  ).all(...rowParams);

  return NextResponse.json({
    items,
    total,
    page,
    pages: Math.ceil(total / limit),
    limit,
  });
}
