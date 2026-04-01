import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, wooAttributeMappings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { roundToNine } from "@/lib/number-format";
import { recordBlockedSync } from "@/lib/woo-sync-utils";
import type { DB } from "@/lib/db";

const PAGE_SIZE = 200;

interface RawProductRow {
  panel_id: number;
  woo_id: number;
  name: string;
  sku: string | null;
  iva_rate: number;
  brand: string | null;
  warranty: string | null;
  attributes: string | null;
  short_description: string | null;
  description: string | null;
  weight_kg: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  local_stock: number;
  own_price_regular: number | null;
  own_price_offer: number | null;
  markup_regular: number;
  markup_offer: number | null;
  offer_start: string | null;
  offer_end: string | null;
  woo_synced_regular_price: number | null;
  woo_manual_private: number;           // 0 | 1
  best_supplier_stock_qty: number;      // stock of cheapest supplier with stock > 0
  best_cost_with_stock: number | null;
}

type WcAttr = { id: number; name: string; options: string[]; visible: boolean };

function buildAttributes(
  row: RawProductRow,
  mappings: { panelKey: string; wooAttributeId: number; wooAttributeName: string }[]
): WcAttr[] {
  const attrs: WcAttr[] = [];

  const addAttr = (panelKey: string, value: string | null | undefined) => {
    if (!value) return;
    const m = mappings.find((x) => x.panelKey === panelKey);
    if (!m) return;
    attrs.push({ id: m.wooAttributeId, name: m.wooAttributeName, options: [value], visible: true });
  };

  addAttr("iva", row.iva_rate === 0.105 ? "0.105" : "0.21");
  addAttr("brand", row.brand);
  addAttr("warranty", row.warranty);

  if (row.attributes) {
    try {
      const parsed = JSON.parse(row.attributes) as Record<string, unknown>;
      for (const [key, val] of Object.entries(parsed)) {
        if (val === null || val === undefined) continue;
        const strVal = typeof val === "boolean" ? (val ? "Sí" : "No") : String(val);
        addAttr(key, strVal);
      }
    } catch {}
  }

  return attrs;
}

/**
 * GET /api/woo-feed
 *
 * Feed endpoint for WordPress pull sync (Option B).
 * Returns up to PAGE_SIZE pending products with computed prices, stock, and status.
 * Applies safeguard checks — blocked products are recorded and excluded from the feed.
 *
 * Auth: X-Panel-Sync-Secret header (WOO_SYNC_SECRET env var)
 *
 * WP polls this endpoint in a loop until count=0. After processing each batch,
 * WP POSTs confirmed woo_ids to /api/woo-feed/confirm.
 */
export async function GET(request: NextRequest) {
  const syncSecret = request.headers.get("x-panel-sync-secret");
  if (!syncSecret || syncSecret !== process.env.WOO_SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load attribute mappings once (shared across all products in batch)
  const mappings = await db.select().from(wooAttributeMappings);

  // Batch SQL: get pending products with supplier aggregates in one query
  const sqlite = (db as DB).$client;
  const rows = sqlite.prepare(`
    SELECT
      p.id                    AS panel_id,
      p.woocommerce_id        AS woo_id,
      p.name,
      p.sku,
      p.iva_rate,
      p.brand,
      p.warranty,
      p.attributes,
      p.short_description,
      p.description,
      p.weight_kg,
      p.length_cm,
      p.width_cm,
      p.height_cm,
      p.local_stock,
      p.own_price_regular,
      p.own_price_offer,
      p.markup_regular,
      p.markup_offer,
      p.offer_start,
      p.offer_end,
      p.woo_synced_regular_price,
      p.woo_manual_private,
      -- Stock of the cheapest supplier with stock > 0 (same supplier used for pricing)
      -- NOT the sum — sum would let customers order more than what's available at the listed price
      COALESCE((
        SELECT psl.supplier_stock_qty
        FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        WHERE psl.product_id = p.id
          AND psl.is_active = 1
          AND psl.supplier_stock_qty > 0
          AND sp.final_cost_ars IS NOT NULL
        ORDER BY sp.final_cost_ars ASC
        LIMIT 1
      ), 0) AS best_supplier_stock_qty,
      -- Best cost from suppliers that have stock > 0
      (
        SELECT MIN(sp.final_cost_ars)
        FROM product_supplier_links psl
        JOIN supplier_prices sp ON sp.link_id = psl.id
        WHERE psl.product_id = p.id
          AND psl.is_active = 1
          AND psl.supplier_stock_qty > 0
          AND sp.final_cost_ars IS NOT NULL
      ) AS best_cost_with_stock
    FROM products p
    WHERE p.woo_sync_pending = 1
      AND p.woocommerce_id IS NOT NULL
    LIMIT ${PAGE_SIZE}
  `).all() as RawProductRow[];

  const feedProducts: Record<string, unknown>[] = [];
  let blockedCount = 0;

  for (const row of rows) {
    const hasOwnStock = row.local_stock > 0;
    const hasOwnPrice = row.own_price_regular != null || row.own_price_offer != null;
    const hasSupplierStock = row.best_supplier_stock_qty > 0;
    const hasCalcPrice = row.best_cost_with_stock != null;

    let status: string;
    let stockStatus: string;
    let featured: boolean;
    let regularPrice: number | null;
    let offerPrice: number | null;
    let stockQty: number;

    // 3-case WC sync logic (mirrors computeSyncPayload)
    if (hasOwnStock || hasOwnPrice) {
      status = "publish";
      stockStatus = "instock";
      featured = row.local_stock > 0;
      // Own stock takes priority; fall back to best supplier stock if we have no own inventory
      stockQty = row.local_stock > 0 ? row.local_stock : row.best_supplier_stock_qty;
      regularPrice = row.own_price_regular
        ?? (row.best_cost_with_stock != null ? row.best_cost_with_stock * row.markup_regular : null);
      offerPrice = row.own_price_offer
        ?? (row.markup_offer && row.best_cost_with_stock != null ? row.best_cost_with_stock * row.markup_offer : null);
    } else if (hasSupplierStock && hasCalcPrice) {
      status = "publish";
      stockStatus = "instock";
      featured = false;
      stockQty = row.best_supplier_stock_qty;
      regularPrice = row.best_cost_with_stock! * row.markup_regular;
      offerPrice = row.markup_offer && row.best_cost_with_stock != null
        ? row.best_cost_with_stock * row.markup_offer
        : null;
    } else {
      status = "private";
      stockStatus = "outofstock";
      featured = false;
      stockQty = 0;
      regularPrice = null;
      offerPrice = null;
    }

    // Manual private override: force status=private regardless of stock/price
    if (row.woo_manual_private) {
      status = "private";
      featured = false;
    }

    // Safeguard: block $0 in-stock products
    const inStock = stockStatus === "instock";
    if (inStock && (regularPrice == null || regularPrice <= 0)) {
      await recordBlockedSync(
        row.panel_id, row.woo_id, row.name,
        "Sin precio configurado: el producto aparecería a $0 en la tienda",
        regularPrice ?? 0, row.woo_synced_regular_price ?? null,
        { regular_price: regularPrice, stock_qty: stockQty }
      );
      await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, row.panel_id));
      blockedCount++;
      continue;
    }

    // Safeguard: block >10% price drop
    if (
      row.woo_synced_regular_price != null &&
      row.woo_synced_regular_price > 0 &&
      regularPrice != null &&
      regularPrice < row.woo_synced_regular_price * 0.90
    ) {
      const dropPercent = Math.round((1 - regularPrice / row.woo_synced_regular_price) * 100);
      await recordBlockedSync(
        row.panel_id, row.woo_id, row.name,
        `Bajada de precio del ${dropPercent}%: de $${Math.round(row.woo_synced_regular_price).toLocaleString("es-AR")} a $${Math.round(regularPrice).toLocaleString("es-AR")}`,
        regularPrice, row.woo_synced_regular_price,
        { regular_price: regularPrice, stock_qty: stockQty }
      );
      await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, row.panel_id));
      blockedCount++;
      continue;
    }

    const regularPriceStr = regularPrice ? String(roundToNine(regularPrice)) : "0";
    const offerPriceStr = offerPrice ? String(roundToNine(offerPrice)) : "";
    const attributes = buildAttributes(row, mappings);

    const entry: Record<string, unknown> = {
      panel_id: row.panel_id,
      woo_id: row.woo_id,
      name: row.name,
      status,
      featured,
      regular_price: regularPriceStr,
      offer_price: offerPriceStr,
      date_on_sale_from: offerPriceStr && row.offer_start ? row.offer_start : null,
      date_on_sale_to: offerPriceStr && row.offer_end ? row.offer_end : null,
      stock_qty: stockQty,
      stock_status: stockStatus,
    };

    if (row.sku) entry.sku = row.sku;
    if (attributes.length > 0) entry.attributes = attributes;
    if (row.short_description) entry.short_description = row.short_description;
    if (row.description) entry.description = row.description;
    if (row.weight_kg) entry.weight = row.weight_kg.toString();
    if (row.length_cm || row.width_cm || row.height_cm) {
      entry.dimensions = {
        length: (row.length_cm ?? 0).toString(),
        width: (row.width_cm ?? 0).toString(),
        height: (row.height_cm ?? 0).toString(),
      };
    }

    feedProducts.push(entry);
  }

  return NextResponse.json({
    products: feedProducts,
    count: feedProducts.length,
    blocked_count: blockedCount,
    page_size: PAGE_SIZE,
  });
}
