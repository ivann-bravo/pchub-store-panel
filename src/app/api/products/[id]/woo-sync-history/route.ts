import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, wooSyncBlocked } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const productId = parseInt(params.id, 10);
  if (isNaN(productId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const [product] = await db
    .select({
      wooLastSyncedAt: products.wooLastSyncedAt,
      wooSyncedRegularPrice: products.wooSyncedRegularPrice,
      woocommerceId: products.woocommerceId,
    })
    .from(products)
    .where(eq(products.id, productId));

  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const history = await db
    .select({
      id: wooSyncBlocked.id,
      status: wooSyncBlocked.status,
      reason: wooSyncBlocked.reason,
      newPrice: wooSyncBlocked.newPrice,
      oldPrice: wooSyncBlocked.oldPrice,
      createdAt: wooSyncBlocked.createdAt,
      reviewedAt: wooSyncBlocked.reviewedAt,
      reviewedBy: wooSyncBlocked.reviewedBy,
    })
    .from(wooSyncBlocked)
    .where(eq(wooSyncBlocked.productId, productId))
    .orderBy(desc(wooSyncBlocked.createdAt))
    .limit(20);

  return NextResponse.json({
    lastSync: product.wooLastSyncedAt
      ? { syncedAt: product.wooLastSyncedAt, syncedPrice: product.wooSyncedRegularPrice }
      : null,
    blockedHistory: history,
  });
}
