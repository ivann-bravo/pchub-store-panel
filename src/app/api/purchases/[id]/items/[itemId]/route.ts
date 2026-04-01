import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrderItems } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// PATCH /api/purchases/[id]/items/[itemId] — update item fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = parseInt(params.id);
  const itemId = parseInt(params.itemId);
  const body = await req.json() as {
    quantity?: number;
    clientPaidAmount?: number | null;
    goesToStock?: boolean;
    stockEntryPrice?: number | null;
    notes?: string | null;
    stockAlertStatus?: "out_of_stock" | "alt_available" | "back_in_stock" | null;
  };

  const [item] = await db
    .update(purchaseOrderItems)
    .set({
      ...(body.quantity != null && { quantity: body.quantity }),
      ...(body.clientPaidAmount !== undefined && { clientPaidAmount: body.clientPaidAmount }),
      ...(body.goesToStock !== undefined && { goesToStock: body.goesToStock }),
      ...(body.stockEntryPrice !== undefined && { stockEntryPrice: body.stockEntryPrice }),
      ...(body.notes !== undefined && { notes: body.notes }),
      ...("stockAlertStatus" in body && { stockAlertStatus: body.stockAlertStatus }),
    })
    .where(and(eq(purchaseOrderItems.id, itemId), eq(purchaseOrderItems.purchaseOrderId, orderId)))
    .returning();

  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  return NextResponse.json(item);
}

// DELETE /api/purchases/[id]/items/[itemId] — remove item from order
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = parseInt(params.id);
  const itemId = parseInt(params.itemId);

  await db
    .delete(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.id, itemId), eq(purchaseOrderItems.purchaseOrderId, orderId)));

  return NextResponse.json({ ok: true });
}
