import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, products, suppliers } from "@/lib/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/purchases/stock-alerts
// Returns all items in open purchase orders that have a non-null stockAlertStatus.
// Used by the dashboard card.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const alertItems = await db
    .select({
      itemId: purchaseOrderItems.id,
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      productId: purchaseOrderItems.productId,
      productName: products.name,
      productSku: products.sku,
      supplierId: purchaseOrderItems.supplierId,
      supplierName: suppliers.name,
      quantity: purchaseOrderItems.quantity,
      stockAlertStatus: purchaseOrderItems.stockAlertStatus,
      wcOrderRef: purchaseOrderItems.wcOrderRef,
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, and(
      eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId),
      eq(purchaseOrders.status, "open")
    ))
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrderItems.supplierId))
    .where(isNotNull(purchaseOrderItems.stockAlertStatus))
    .orderBy(purchaseOrderItems.stockAlertStatus);

  return NextResponse.json(alertItems);
}
