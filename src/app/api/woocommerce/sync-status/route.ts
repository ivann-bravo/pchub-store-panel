import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { isNotNull, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db
    .select({
      total: sql<number>`COUNT(*)`,
      pending: sql<number>`SUM(CASE WHEN woo_sync_pending = 1 THEN 1 ELSE 0 END)`,
      neverSynced: sql<number>`SUM(CASE WHEN woo_last_synced_at IS NULL AND woo_sync_pending = 0 THEN 1 ELSE 0 END)`,
      lastSyncedAt: sql<string | null>`MAX(woo_last_synced_at)`,
    })
    .from(products)
    .where(isNotNull(products.woocommerceId));

  return NextResponse.json({
    total: row?.total ?? 0,
    pending: row?.pending ?? 0,
    neverSynced: row?.neverSynced ?? 0,
    lastSyncedAt: row?.lastSyncedAt ?? null,
  });
}
