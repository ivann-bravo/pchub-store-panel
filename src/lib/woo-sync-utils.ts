import { db } from "@/lib/db";
import { products, productSupplierLinks, supplierPrices, wooAttributeMappings, wooSyncBlocked } from "@/lib/db/schema";
import { eq, and, sql, notInArray } from "drizzle-orm";
import { roundToNine } from "@/lib/number-format";

export function buildWcAuth(): string {
  const key = process.env.WOO_CONSUMER_KEY ?? "";
  const secret = process.env.WOO_CONSUMER_SECRET ?? "";
  return Buffer.from(`${key}:${secret}`).toString("base64");
}

/** Returns the standard headers for all server-to-WooCommerce requests. */
export function buildWcHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const syncSecret = process.env.WOO_SYNC_SECRET;
  if (syncSecret) headers["X-Panel-Sync-Secret"] = syncSecret;
  return headers;
}

/**
 * Appends WooCommerce consumer_key/secret as query params to a URL.
 * Used for GET requests — avoids LiteSpeed Cache serving a cached response
 * (LiteSpeed caches "clean" URLs; adding unique query params guarantees a cache miss).
 */
export function appendWcAuth(url: string): string {
  const key = process.env.WOO_CONSUMER_KEY ?? "";
  const secret = process.env.WOO_CONSUMER_SECRET ?? "";
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}consumer_key=${encodeURIComponent(key)}&consumer_secret=${encodeURIComponent(secret)}`;
}

export function getWcBaseUrl(): string {
  return (process.env.WOO_URL ?? "").replace(/\/+$/, "");
}

export interface SyncPayloadResult {
  wooId: number;
  productId: number;
  productName: string;
  data: Record<string, unknown>;
  safeguard: { blocked: boolean; reason?: string; newPrice?: number | null; oldPrice?: number | null };
  regularPrice: number | null;
  offerPrice: number | null;
  stockQty: number;
  prevRegularPrice: number | null;
  prevOfferPrice: number | null;
  prevStockQty: number | null;
}

/** Computes the full WooCommerce sync payload for a panel product (same logic as sync-payload route). */
export async function computeSyncPayload(productId: number): Promise<SyncPayloadResult | null> {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product || !product.woocommerceId) return null;

  const mappings = await db.select().from(wooAttributeMappings);

  const links = await db
    .select({
      isActive: productSupplierLinks.isActive,
      stockQty: productSupplierLinks.supplierStockQty,
      finalCostArs: supplierPrices.finalCostArs,
    })
    .from(productSupplierLinks)
    .leftJoin(supplierPrices, eq(supplierPrices.linkId, productSupplierLinks.id))
    .where(eq(productSupplierLinks.productId, productId));

  const activeLinks = links.filter((l) => l.isActive);
  const withStock = activeLinks
    .filter((l) => (l.stockQty ?? 0) > 0 && l.finalCostArs != null)
    .sort((a, b) => (a.finalCostArs ?? 0) - (b.finalCostArs ?? 0));

  const bestCostArs = withStock[0]?.finalCostArs ?? null;
  // Stock of the best-price supplier (the one whose price is used) — NOT sum of all suppliers.
  // Using total stock would mislead customers: if the cheapest supplier has 2 units and others
  // have 8 at a much higher price, showing 10 lets customers order more than we can fulfill at
  // the displayed price.
  const bestSupplierStockQty = withStock[0]?.stockQty ?? 0;
  const hasSupplierStockActual = bestSupplierStockQty > 0;
  const hasCalculatedPrice = bestCostArs != null;

  const hasOwnStock = product.localStock > 0;
  const hasOwnPrice = product.ownPriceRegular != null || product.ownPriceOffer != null;

  let status: string;
  let stockStatus: string;
  let featured: boolean;
  let regularPrice: number | null;
  let offerPrice: number | null;
  let stockQty: number;

  if (hasOwnStock || hasOwnPrice) {
    status = "publish";
    stockStatus = "instock";
    featured = product.localStock > 0; // featured = ONLY products with actual own stock
    // Own stock takes priority; fall back to best supplier stock if we have no own inventory
    stockQty = product.localStock > 0 ? product.localStock : bestSupplierStockQty;
    regularPrice = product.ownPriceRegular
      ?? (bestCostArs ? bestCostArs * product.markupRegular : null);
    offerPrice = product.ownPriceOffer
      ?? (product.markupOffer && bestCostArs ? bestCostArs * product.markupOffer : null);
  } else if (hasSupplierStockActual && hasCalculatedPrice) {
    status = "publish";
    stockStatus = "instock";
    featured = false;
    stockQty = bestSupplierStockQty;
    regularPrice = bestCostArs * product.markupRegular;
    offerPrice = product.markupOffer && bestCostArs ? bestCostArs * product.markupOffer : null;
  } else {
    status = "private";
    stockStatus = "outofstock";
    featured = false;
    stockQty = 0;
    regularPrice = null;
    offerPrice = null;
  }

  // Manual private override: force status=private regardless of stock/price
  if (product.wooManualPrivate) {
    status = "private";
    featured = false;
  }

  const wooSyncedRegularPrice = product.wooSyncedRegularPrice ?? null;
  const inStock = stockStatus === "instock";
  let safeguard: SyncPayloadResult["safeguard"] = { blocked: false };

  if (inStock && (regularPrice == null || regularPrice <= 0)) {
    safeguard = {
      blocked: true,
      reason: "Sin precio configurado: el producto aparecería a $0 en la tienda",
      newPrice: regularPrice ?? 0,
      oldPrice: wooSyncedRegularPrice,
    };
  } else if (
    wooSyncedRegularPrice != null &&
    wooSyncedRegularPrice > 0 &&
    regularPrice != null &&
    regularPrice < wooSyncedRegularPrice * 0.90
  ) {
    const dropPercent = Math.round((1 - regularPrice / wooSyncedRegularPrice) * 100);
    safeguard = {
      blocked: true,
      reason: `Bajada de precio del ${dropPercent}%: de $${Math.round(wooSyncedRegularPrice).toLocaleString("es-AR")} a $${Math.round(regularPrice).toLocaleString("es-AR")}`,
      newPrice: regularPrice,
      oldPrice: wooSyncedRegularPrice,
    };
  }

  type WcAttr = { id: number; name: string; options: string[]; visible: boolean };
  const attributes: WcAttr[] = [];

  const addAttr = (panelKey: string, value: string | null | undefined) => {
    if (!value) return;
    const m = mappings.find((x) => x.panelKey === panelKey);
    if (!m) return;
    attributes.push({ id: m.wooAttributeId, name: m.wooAttributeName, options: [value], visible: true });
  };

  addAttr("iva", product.ivaRate === 0.105 ? "0.105" : "0.21");
  addAttr("brand", product.brand);
  addAttr("warranty", product.warranty);

  // Technical attributes stored in product.attributes JSON (socket, memoryType, coolerStock, etc.)
  if (product.attributes) {
    try {
      const attrs = JSON.parse(product.attributes) as Record<string, unknown>;
      for (const [key, val] of Object.entries(attrs)) {
        if (val === null || val === undefined) continue;
        const strVal = typeof val === "boolean" ? (val ? "Sí" : "No") : String(val);
        addAttr(key, strVal);
      }
    } catch {}
  }

  const data: Record<string, unknown> = {
    name: product.name,
    status,
    featured,
    manage_stock: true,
    stock_quantity: stockQty,
    stock_status: stockStatus,
    regular_price: regularPrice ? String(roundToNine(regularPrice)) : "0",
    sale_price: offerPrice ? String(roundToNine(offerPrice)) : "",
    date_on_sale_from: offerPrice && product.offerStart ? product.offerStart : null,
    date_on_sale_to: offerPrice && product.offerEnd ? product.offerEnd : null,
  };
  // Only include attributes if there are mapped ones to send.
  // Sending attributes:[] to WC clears ALL existing attributes — never do that.
  if (attributes.length > 0) data.attributes = attributes;

  if (product.sku) data.sku = product.sku;
  if (product.shortDescription) data.short_description = product.shortDescription;
  if (product.description) data.description = product.description;
  if (product.weightKg) data.weight = product.weightKg.toString();
  if (product.lengthCm || product.widthCm || product.heightCm) {
    data.dimensions = {
      length: (product.lengthCm ?? 0).toString(),
      width: (product.widthCm ?? 0).toString(),
      height: (product.heightCm ?? 0).toString(),
    };
  }

  return {
    wooId: product.woocommerceId,
    productId,
    productName: product.name,
    data,
    safeguard,
    regularPrice,
    offerPrice,
    stockQty,
    prevRegularPrice: product.wooSyncedRegularPrice ?? null,
    prevOfferPrice: product.wooSyncedOfferPrice ?? null,
    prevStockQty: product.wooSyncedStockQty ?? null,
  };
}

/**
 * Pushes ONE product payload to WooCommerce server-to-server (used by cron for retries).
 * Returns { ok, error } — does NOT handle safeguards (caller decides).
 */
export async function pushToWooCommerce(
  wooId: number,
  data: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY) return { ok: false, error: "WooCommerce not configured" };

  try {
    const res = await fetch(appendWcAuth(`${baseUrl}/wp-json/wc/v3/products/${wooId}`), {
      method: "PUT",
      headers: buildWcHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface BatchUpdateResult {
  wooId: number;
  ok: boolean;
  error?: string;
}

/**
 * Sends a batch update to WooCommerce: up to 100 products in a single HTTP request.
 * ~100x fewer round-trips than individual PUT calls — much faster for large catalogs.
 */
export async function pushToWooCommerceBatch(
  updates: Array<{ wooId: number; data: Record<string, unknown> }>
): Promise<BatchUpdateResult[]> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY) {
    return updates.map((u) => ({ wooId: u.wooId, ok: false, error: "WooCommerce not configured" }));
  }

  try {
    const body = {
      update: updates.map((u) => ({ id: u.wooId, ...u.data })),
    };
    const res = await fetch(appendWcAuth(`${baseUrl}/wp-json/wc/v3/products/batch`), {
      method: "POST",
      headers: buildWcHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), // 20s limit keeps cron under the 30s cron-job.org timeout
    });

    if (!res.ok) {
      const text = await res.text();
      const error = `HTTP ${res.status}: ${text.slice(0, 200)}`;
      return updates.map((u) => ({ wooId: u.wooId, ok: false, error }));
    }

    interface BatchItem { id: number; error?: { message: string; code?: string } }
    const responseData = await res.json() as { update?: BatchItem[] };
    const responseById = new Map<number, BatchItem>();
    for (const item of (responseData.update ?? [])) {
      responseById.set(item.id, item);
    }

    return updates.map((u) => {
      const item = responseById.get(u.wooId);
      if (!item) return { wooId: u.wooId, ok: false, error: "Not in WC response" };
      if (item.error) return { wooId: u.wooId, ok: false, error: `${item.error.code ?? ""}: ${item.error.message}` };
      return { wooId: u.wooId, ok: true };
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return updates.map((u) => ({ wooId: u.wooId, ok: false, error }));
  }
}

/**
 * Marks a blocked sync in the woo_sync_blocked table.
 * Clears any existing pending entry for the same product first.
 */
export async function recordBlockedSync(
  productId: number,
  wooId: number,
  productName: string,
  reason: string,
  newPrice: number | null,
  oldPrice: number | null,
  payload: Record<string, unknown>
): Promise<void> {
  await db
    .delete(wooSyncBlocked)
    .where(and(eq(wooSyncBlocked.productId, productId), eq(wooSyncBlocked.status, "pending")));

  await db.insert(wooSyncBlocked).values({
    productId,
    wooId,
    productName,
    reason,
    newPrice: newPrice ?? null,
    oldPrice: oldPrice ?? null,
    payload: JSON.stringify(payload),
  });

  // Keep only the last 50 records per product to avoid unbounded growth
  const kept = await db
    .select({ id: wooSyncBlocked.id })
    .from(wooSyncBlocked)
    .where(eq(wooSyncBlocked.productId, productId))
    .orderBy(sql`${wooSyncBlocked.createdAt} DESC`)
    .limit(50);

  if (kept.length === 50) {
    const keptIds = kept.map((r) => r.id);
    await db
      .delete(wooSyncBlocked)
      .where(and(eq(wooSyncBlocked.productId, productId), notInArray(wooSyncBlocked.id, keptIds)));
  }
}
