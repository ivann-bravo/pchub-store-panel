import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WOO_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  computeSyncPayload,
  pushToWooCommerceBatch,
  recordBlockedSync,
} from "@/lib/woo-sync-utils";

const CHUNK = 200;          // products per call — sent as 2 batch requests to WC
const PAYLOAD_CONCURRENCY = 5; // parallel DB payload computations

/**
 * POST /api/woocommerce/run-sync
 * UI-driven sync using WC batch API: fetches CHUNK pending products, computes their
 * payloads, then sends them all in a single POST /wc/v3/products/batch request.
 * This is ~100x fewer HTTP round-trips than individual PUT calls.
 * SUPER_ADMIN only.
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_WOO_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as { limit?: number };
  const limit = Math.min(body.limit ?? CHUNK, 200);

  // Total still pending (for progress tracking)
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products)
    .where(and(eq(products.wooSyncPending, true), isNotNull(products.woocommerceId)));

  const pending = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.wooSyncPending, true), isNotNull(products.woocommerceId)))
    .orderBy(
      sql`woo_manual_private DESC`,
      sql`woo_last_synced_at ASC NULLS FIRST`,
      products.id
    )
    .limit(limit);

  if (pending.length === 0) {
    return NextResponse.json({ synced: 0, blocked: 0, errors: 0, processed: 0, clearedThisCall: 0, remaining: 0, hasMore: false });
  }

  // ── Step 1: Compute all payloads in parallel (DB queries only, no WC calls yet) ──
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
  let cleared = 0;
  const errors: { id: number; error: string }[] = [];
  const toSync: Array<{
    productId: number;
    wooId: number;
    data: Record<string, unknown>;
    regularPrice: number | null;
    offerPrice: number | null;
    stockQty: number;
  }> = [];

  for (const { productId, payload } of payloadResults) {
    if (!payload) {
      // No woocommerceId anymore — just clear the flag
      await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, productId));
      cleared++;
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
      continue;
    }
    toSync.push({
      productId,
      wooId: payload.wooId,
      data: payload.data,
      regularPrice: payload.regularPrice,
      offerPrice: payload.offerPrice,
      stockQty: payload.stockQty,
    });
  }

  // ── Step 3: One batch call to WC for all non-blocked products ──
  let synced = 0;
  if (toSync.length > 0) {
    const batchResults = await pushToWooCommerceBatch(
      toSync.map(({ wooId, data }) => ({ wooId, data }))
    );

    const now = new Date().toISOString();
    for (const item of toSync) {
      const result = batchResults.find((r) => r.wooId === item.wooId);
      if (result?.ok) {
        await db.update(products).set({
          wooSyncPending: false,
          wooSyncedRegularPrice: item.regularPrice,
          wooSyncedOfferPrice: item.offerPrice,
          wooSyncedStockQty: item.stockQty,
          wooLastSyncedAt: now,
        }).where(eq(products.id, item.productId));
        synced++;
      } else if (result?.error?.includes("404")) {
        // Product deleted from WC — stop retrying
        await db.update(products).set({ wooSyncPending: false }).where(eq(products.id, item.productId));
        cleared++;
      } else {
        errors.push({ id: item.productId, error: result?.error ?? "Unknown error" });
        // keep wooSyncPending=true — cron will retry
      }
    }
  }

  const clearedThisCall = synced + blocked + cleared;
  const remaining = Math.max(0, Number(total) - clearedThisCall);

  return NextResponse.json({
    synced,
    blocked,
    errors: errors.length,
    processed: pending.length,
    clearedThisCall,
    remaining,
    hasMore: remaining > 0,
  });
}
