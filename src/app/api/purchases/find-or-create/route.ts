import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// POST /api/purchases/find-or-create — find open order for supplier or create one
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { supplierId: number };
  if (!body.supplierId) return NextResponse.json({ error: "supplierId required" }, { status: 400 });

  const existing = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.supplierId, body.supplierId), eq(purchaseOrders.status, "open")))
    .limit(1);

  if (existing.length > 0) return NextResponse.json(existing[0]);

  const [created] = await db
    .insert(purchaseOrders)
    .values({ supplierId: body.supplierId })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
