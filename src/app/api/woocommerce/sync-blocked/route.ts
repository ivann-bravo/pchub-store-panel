import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { wooSyncBlocked } from "@/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";

/**
 * POST /api/woocommerce/sync-blocked
 * Inserts a new blocked sync entry. Clears older pending entries for the same product first.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json() as {
    productId: number;
    wooId: number;
    productName: string;
    reason: string;
    newPrice?: number | null;
    oldPrice?: number | null;
    payload: unknown;
  };

  // Clear older pending entries for same product to avoid duplicate queue entries
  await db
    .delete(wooSyncBlocked)
    .where(and(eq(wooSyncBlocked.productId, body.productId), eq(wooSyncBlocked.status, "pending")));

  const [inserted] = await db
    .insert(wooSyncBlocked)
    .values({
      productId: body.productId,
      wooId: body.wooId,
      productName: body.productName,
      reason: body.reason,
      newPrice: body.newPrice ?? null,
      oldPrice: body.oldPrice ?? null,
      payload: JSON.stringify(body.payload),
    })
    .returning();

  return NextResponse.json(inserted, { status: 201 });
}

/**
 * GET /api/woocommerce/sync-blocked
 * Query params: status (pending/approved/rejected/all), limit, page
 * Always returns pendingCount regardless of status filter.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";
  const limit = parseInt(searchParams.get("limit") ?? "20", 10);
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const offset = (page - 1) * limit;

  // Always get pending count
  const [{ pendingCount }] = await db
    .select({ pendingCount: sql<number>`COUNT(*)` })
    .from(wooSyncBlocked)
    .where(eq(wooSyncBlocked.status, "pending"));

  let items;
  let total = 0;

  if (status === "all") {
    const rows = await db
      .select()
      .from(wooSyncBlocked)
      .orderBy(desc(wooSyncBlocked.createdAt))
      .limit(limit)
      .offset(offset);
    items = rows;
    const [{ cnt }] = await db.select({ cnt: sql<number>`COUNT(*)` }).from(wooSyncBlocked);
    total = cnt;
  } else {
    const statusVal = status as "pending" | "approved" | "rejected";
    const rows = await db
      .select()
      .from(wooSyncBlocked)
      .where(eq(wooSyncBlocked.status, statusVal))
      .orderBy(desc(wooSyncBlocked.createdAt))
      .limit(limit)
      .offset(offset);
    items = rows;
    const [{ cnt }] = await db
      .select({ cnt: sql<number>`COUNT(*)` })
      .from(wooSyncBlocked)
      .where(eq(wooSyncBlocked.status, statusVal));
    total = cnt;
  }

  return NextResponse.json({ items, total, pendingCount });
}
