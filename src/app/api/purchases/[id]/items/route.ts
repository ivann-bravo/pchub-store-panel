import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, productSupplierLinks, supplierPrices } from "@/lib/db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// POST /api/purchases/[id]/items — add item to purchase order
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = parseInt(params.id);

  // Verify order is open
  const [order] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status !== "open") return NextResponse.json({ error: "Order is closed" }, { status: 400 });

  const body = await req.json() as {
    productId: number;
    quantity: number;
    clientPaidAmount?: number;
    wcOrderId?: number;
    wcOrderRef?: string;
    goesToStock?: boolean;
    notes?: string;
    // Optional: override supplier (if not provided, auto-select cheapest with stock)
    supplierId?: number;
  };

  if (!body.productId || !body.quantity) return NextResponse.json({ error: "productId and quantity required" }, { status: 400 });

  // Auto-select cheapest active supplier with stock (or use provided supplierId)
  let assignedSupplierId = body.supplierId ?? null;
  let assignedSupplierCode = "";
  let unitCostArs: number | null = null;

  const supplierLinks = await db
    .select({
      linkId: productSupplierLinks.id,
      supplierId: productSupplierLinks.supplierId,
      supplierCode: productSupplierLinks.supplierCode,
      stockQty: productSupplierLinks.supplierStockQty,
      finalCostArs: supplierPrices.finalCostArs,
    })
    .from(productSupplierLinks)
    .leftJoin(supplierPrices, eq(supplierPrices.linkId, productSupplierLinks.id))
    .where(
      and(
        eq(productSupplierLinks.productId, body.productId),
        eq(productSupplierLinks.isActive, true)
      )
    )
    .orderBy(asc(supplierPrices.finalCostArs));

  const withStock = supplierLinks.filter((l) => (l.stockQty ?? 0) > 0 && l.finalCostArs != null);

  if (assignedSupplierId) {
    // Use provided supplier
    const match = supplierLinks.find((l) => l.supplierId === assignedSupplierId);
    if (match) {
      assignedSupplierCode = match.supplierCode;
      unitCostArs = match.finalCostArs ?? null;
    }
  } else if (withStock.length > 0) {
    // Auto-select cheapest with stock
    const best = withStock[0];
    assignedSupplierId = best.supplierId;
    assignedSupplierCode = best.supplierCode;
    unitCostArs = best.finalCostArs ?? null;
  } else if (supplierLinks.length > 0) {
    // Fallback: cheapest link even without stock
    const first = supplierLinks[0];
    assignedSupplierId = first.supplierId;
    assignedSupplierCode = first.supplierCode;
    unitCostArs = first.finalCostArs ?? null;
  }

  if (!assignedSupplierId) return NextResponse.json({ error: "No supplier found for this product" }, { status: 400 });

  // Check if this product already exists in the order — if so, consolidate quantities
  const [existing] = await db
    .select()
    .from(purchaseOrderItems)
    .where(and(eq(purchaseOrderItems.purchaseOrderId, orderId), eq(purchaseOrderItems.productId, body.productId)))
    .limit(1);

  if (existing) {
    // Build a detail line for the client breakdown in notes
    const newQty = body.quantity;
    const refLabel = body.wcOrderRef ? `#${body.wcOrderRef}` : "Manual";
    const paidLabel = body.clientPaidAmount ? ` ($${Math.round(body.clientPaidAmount).toLocaleString("es-AR")})` : "";
    const detailLine = `${refLabel}: ${newQty}x${paidLabel}`;

    // On first consolidation: also record the original item's client info in notes
    let updatedNotes = existing.notes ?? "";
    if (!updatedNotes && (existing.wcOrderRef || existing.clientPaidAmount)) {
      const origRef = existing.wcOrderRef ? `#${existing.wcOrderRef}` : "Manual";
      const origPaid = existing.clientPaidAmount ? ` ($${Math.round(existing.clientPaidAmount).toLocaleString("es-AR")})` : "";
      updatedNotes = `${origRef}: ${existing.quantity}x${origPaid}`;
    }
    updatedNotes = updatedNotes ? `${updatedNotes}\n${detailLine}` : detailLine;

    const [updated] = await db
      .update(purchaseOrderItems)
      .set({
        quantity: sql`${purchaseOrderItems.quantity} + ${newQty}`,
        clientPaidAmount: existing.clientPaidAmount != null || body.clientPaidAmount != null
          ? sql`COALESCE(${purchaseOrderItems.clientPaidAmount}, 0) + ${body.clientPaidAmount ?? 0}`
          : null,
        notes: updatedNotes,
      })
      .where(eq(purchaseOrderItems.id, existing.id))
      .returning();

    return NextResponse.json(updated, { status: 200 });
  }

  // New product in this order — insert normally
  const [item] = await db
    .insert(purchaseOrderItems)
    .values({
      purchaseOrderId: orderId,
      productId: body.productId,
      supplierId: assignedSupplierId,
      supplierCode: assignedSupplierCode,
      quantity: body.quantity,
      unitCostArs,
      clientPaidAmount: body.clientPaidAmount ?? null,
      wcOrderId: body.wcOrderId ?? null,
      wcOrderRef: body.wcOrderRef ?? null,
      goesToStock: body.goesToStock ?? false,
      notes: body.notes ?? null,
    })
    .returning();

  return NextResponse.json(item, { status: 201 });
}
