import { NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WOO_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { isNotNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * POST /api/woocommerce/force-sync-all
 * Marks ALL WooCommerce-linked products as pending sync, bypassing change detection.
 * Does NOT clear price/stock baselines — they are needed for:
 *   - The >10% price-drop safeguard (wooSyncedRegularPrice)
 *   - Change detection after the force sync completes
 * The run-sync endpoint processes them with high concurrency.
 */
export async function POST() {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_WOO_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db
    .update(products)
    .set({ wooSyncPending: true })
    .where(isNotNull(products.woocommerceId));

  const [{ cnt }] = await db
    .select({ cnt: sql<number>`COUNT(*)` })
    .from(products)
    .where(isNotNull(products.woocommerceId));

  console.log(`[force-sync-all] Queued ${cnt} WC-linked products for sync`);
  return NextResponse.json({ queued: Number(cnt) });
}
