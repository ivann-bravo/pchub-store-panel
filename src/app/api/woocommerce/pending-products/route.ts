import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * GET /api/woocommerce/pending-products
 * Returns count + list of products waiting to sync to WooCommerce.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products)
    .where(and(eq(products.wooSyncPending, true), isNotNull(products.woocommerceId)));

  const items = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      woocommerceId: products.woocommerceId,
      wooSyncedRegularPrice: products.wooSyncedRegularPrice,
      wooSyncedStockQty: products.wooSyncedStockQty,
      wooLastSyncedAt: products.wooLastSyncedAt,
      wooManualPrivate: products.wooManualPrivate,
    })
    .from(products)
    .where(and(eq(products.wooSyncPending, true), isNotNull(products.woocommerceId)))
    .orderBy(
      sql`woo_manual_private DESC`,
      sql`woo_last_synced_at ASC NULLS FIRST`,
      products.id
    )
    .limit(100);

  return NextResponse.json({ total, items });
}
