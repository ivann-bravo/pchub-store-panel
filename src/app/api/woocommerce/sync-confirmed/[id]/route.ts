import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/woocommerce/sync-confirmed/[id]
 * Body: { regularPrice: number }
 * Called after every successful WC sync. Updates woo_synced_regular_price and woo_last_synced_at.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const productId = parseInt(params.id, 10);
  if (isNaN(productId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const { regularPrice } = await request.json() as { regularPrice: number };

  await db
    .update(products)
    .set({
      wooSyncedRegularPrice: regularPrice,
      wooLastSyncedAt: new Date().toISOString(),
    })
    .where(eq(products.id, productId));

  return NextResponse.json({ ok: true });
}
