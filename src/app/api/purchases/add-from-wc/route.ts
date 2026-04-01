import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, productSupplierLinks, supplierPrices } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// POST /api/purchases/add-from-wc
// Finds or creates an open order for the cheapest supplier of the product,
// then adds the item to that order. Used by the WC import modal.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    productId: number;
    quantity: number;
    clientPaidAmount: number;
    wcOrderId: number;
    wcOrderRef: string;
  };

  if (!body.productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

  // Find the cheapest active supplier with stock
  const links = await db
    .select({
      supplierId: productSupplierLinks.supplierId,
      supplierCode: productSupplierLinks.supplierCode,
      stockQty: productSupplierLinks.supplierStockQty,
      finalCostArs: supplierPrices.finalCostArs,
    })
    .from(productSupplierLinks)
    .leftJoin(supplierPrices, eq(supplierPrices.linkId, productSupplierLinks.id))
    .where(and(eq(productSupplierLinks.productId, body.productId), eq(productSupplierLinks.isActive, true)))
    .orderBy(asc(supplierPrices.finalCostArs));

  const withStock = links.filter((l) => (l.stockQty ?? 0) > 0 && l.finalCostArs != null);
  const best = withStock[0] ?? links[0];

  if (!best) return NextResponse.json({ error: "No supplier found for product" }, { status: 400 });

  const supplierId = best.supplierId;

  // Find or create open order for that supplier
  const existing = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.supplierId, supplierId), eq(purchaseOrders.status, "open")))
    .limit(1);

  let orderId: number;
  if (existing.length > 0) {
    orderId = existing[0].id;
  } else {
    const [newOrder] = await db
      .insert(purchaseOrders)
      .values({ supplierId })
      .returning();
    orderId = newOrder.id;
  }

  // Add item
  const [item] = await db
    .insert(purchaseOrderItems)
    .values({
      purchaseOrderId: orderId,
      productId: body.productId,
      supplierId,
      supplierCode: best.supplierCode,
      quantity: body.quantity,
      unitCostArs: best.finalCostArs ?? null,
      clientPaidAmount: body.clientPaidAmount,
      wcOrderId: body.wcOrderId,
      wcOrderRef: body.wcOrderRef,
      goesToStock: false,
    })
    .returning();

  return NextResponse.json({ orderId, item }, { status: 201 });
}
