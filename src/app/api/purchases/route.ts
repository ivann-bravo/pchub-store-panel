import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, suppliers } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/purchases — list orders with supplier info and item counts
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "open";

  const orders = await db
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      supplierOrderNumber: purchaseOrders.supplierOrderNumber,
      totalPaid: purchaseOrders.totalPaid,
      notes: purchaseOrders.notes,
      createdAt: purchaseOrders.createdAt,
      closedAt: purchaseOrders.closedAt,
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierCode: suppliers.code,
    })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(status === "all" ? undefined : eq(purchaseOrders.status, status as "open" | "closed"))
    .orderBy(desc(purchaseOrders.createdAt));

  // Attach item counts and estimated totals
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return NextResponse.json(orders);

  const itemStats = await db
    .select({
      purchaseOrderId: purchaseOrderItems.purchaseOrderId,
      itemCount: sql<number>`COUNT(*)`,
      estimatedTotal: sql<number>`SUM(COALESCE(unit_cost_ars, 0) * quantity)`,
      clientTotal: sql<number>`SUM(COALESCE(client_paid_amount, 0))`,
      stockAlertCount: sql<number>`SUM(CASE WHEN stock_alert_status IS NOT NULL THEN 1 ELSE 0 END)`,
      backInStockCount: sql<number>`SUM(CASE WHEN stock_alert_status = 'back_in_stock' THEN 1 ELSE 0 END)`,
    })
    .from(purchaseOrderItems)
    .where(sql`${purchaseOrderItems.purchaseOrderId} IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})`)
    .groupBy(purchaseOrderItems.purchaseOrderId);

  const statsMap = new Map(itemStats.map((s) => [s.purchaseOrderId, s]));

  return NextResponse.json(
    orders.map((o) => ({
      ...o,
      itemCount: statsMap.get(o.id)?.itemCount ?? 0,
      estimatedTotal: statsMap.get(o.id)?.estimatedTotal ?? 0,
      clientTotal: statsMap.get(o.id)?.clientTotal ?? 0,
      stockAlertCount: statsMap.get(o.id)?.stockAlertCount ?? 0,
      backInStockCount: statsMap.get(o.id)?.backInStockCount ?? 0,
    }))
  );
}

// POST /api/purchases — create a new open purchase order for a supplier
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { supplierId: number; notes?: string };
  if (!body.supplierId) return NextResponse.json({ error: "supplierId required" }, { status: 400 });

  const [order] = await db
    .insert(purchaseOrders)
    .values({ supplierId: body.supplierId, notes: body.notes ?? null })
    .returning();

  return NextResponse.json(order, { status: 201 });
}
