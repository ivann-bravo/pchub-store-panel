import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { historicalMargins } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET — list all historical margin entries
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(historicalMargins)
    .orderBy(historicalMargins.year, historicalMargins.month, historicalMargins.week);

  return NextResponse.json(rows);
}

// POST — upsert one or many entries (SUPER_ADMIN only)
// Body: single entry or array of entries
// Each entry: { year, month, week?, cashRevenue, stockValue, totalCost, cashMargin, totalMargin, orderCount?, notes? }
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as unknown;
  const entries = Array.isArray(body) ? body : [body];

  interface EntryInput {
    year: number; month: number; week?: number | null;
    cashRevenue?: number; stockValue?: number; totalCost?: number;
    cashMargin?: number; totalMargin?: number; orderCount?: number; notes?: string;
  }

  let upserted = 0;
  for (const e of entries as EntryInput[]) {
    if (!e.year || !e.month) continue;
    const cashRevenue = e.cashRevenue ?? 0;
    const stockValue = e.stockValue ?? 0;
    const totalCost = e.totalCost ?? 0;
    const cashMargin = e.cashMargin ?? (cashRevenue - totalCost);
    const totalMargin = e.totalMargin ?? (cashMargin + stockValue);

    // Try to update existing, then insert if not found
    const existing = await db
      .select({ id: historicalMargins.id })
      .from(historicalMargins)
      .where(
        e.week != null
          ? and(eq(historicalMargins.year, e.year), eq(historicalMargins.month, e.month), eq(historicalMargins.week, e.week))
          : and(eq(historicalMargins.year, e.year), eq(historicalMargins.month, e.month))
      )
      .limit(1);

    if (existing.length > 0) {
      await db.update(historicalMargins).set({
        cashRevenue, stockValue, totalCost, cashMargin, totalMargin,
        orderCount: e.orderCount ?? 0,
        notes: e.notes ?? null,
      }).where(eq(historicalMargins.id, existing[0].id));
    } else {
      await db.insert(historicalMargins).values({
        year: e.year,
        month: e.month,
        week: e.week ?? null,
        cashRevenue, stockValue, totalCost, cashMargin, totalMargin,
        orderCount: e.orderCount ?? 0,
        notes: e.notes ?? null,
      });
    }
    upserted++;
  }

  return NextResponse.json({ upserted });
}

// DELETE — remove a specific entry by id (SUPER_ADMIN only)
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await req.json() as { id: number };
  await db.delete(historicalMargins).where(eq(historicalMargins.id, id));
  return NextResponse.json({ ok: true });
}
