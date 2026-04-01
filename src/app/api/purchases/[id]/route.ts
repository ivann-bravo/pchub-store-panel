import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, suppliers, products, productSupplierLinks, supplierPrices } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/purchases/[id] — full order with items and product info
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  const [order] = await db
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
    .where(eq(purchaseOrders.id, id));

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      productName: products.name,
      productSku: products.sku,
      supplierId: purchaseOrderItems.supplierId,
      supplierCode: purchaseOrderItems.supplierCode,
      quantity: purchaseOrderItems.quantity,
      unitCostArs: purchaseOrderItems.unitCostArs,
      clientPaidAmount: purchaseOrderItems.clientPaidAmount,
      wcOrderId: purchaseOrderItems.wcOrderId,
      wcOrderRef: purchaseOrderItems.wcOrderRef,
      goesToStock: purchaseOrderItems.goesToStock,
      stockEntryPrice: purchaseOrderItems.stockEntryPrice,
      notes: purchaseOrderItems.notes,
      stockAlertStatus: purchaseOrderItems.stockAlertStatus,
      createdAt: purchaseOrderItems.createdAt,
    })
    .from(purchaseOrderItems)
    .innerJoin(products, eq(products.id, purchaseOrderItems.productId))
    .where(eq(purchaseOrderItems.purchaseOrderId, id));

  // For each UNIQUE product: find assigned supplier current stock + alternatives.
  // Deduplicate by productId first so we don't run N²  queries for duplicate rows.
  const uniqueProductIds = Array.from(new Set(items.map((i) => i.productId)));
  const supplierInfoByProductId = new Map<number, { assignedSupplierStockQty: number; alternatives: { supplierId: number; supplierName: string; supplierCode: string; supplierProductCode: string; finalCostArs: number; stockQty: number }[] }>();

  await Promise.all(
    uniqueProductIds.map(async (productId) => {
      const representativeItem = items.find((i) => i.productId === productId)!;
      const [assignedLink] = await db
        .select({ stockQty: productSupplierLinks.supplierStockQty })
        .from(productSupplierLinks)
        .where(
          and(
            eq(productSupplierLinks.productId, productId),
            eq(productSupplierLinks.supplierId, representativeItem.supplierId),
            eq(productSupplierLinks.isActive, true)
          )
        )
        .limit(1);

      const alternatives = await db
        .select({
          supplierId: suppliers.id,
          supplierName: suppliers.name,
          supplierCode: suppliers.code,
          supplierProductCode: productSupplierLinks.supplierCode,
          finalCostArs: supplierPrices.finalCostArs,
          stockQty: productSupplierLinks.supplierStockQty,
        })
        .from(productSupplierLinks)
        .innerJoin(suppliers, eq(suppliers.id, productSupplierLinks.supplierId))
        .innerJoin(supplierPrices, eq(supplierPrices.linkId, productSupplierLinks.id))
        .where(
          and(
            eq(productSupplierLinks.productId, productId),
            eq(productSupplierLinks.isActive, true),
            sql`${productSupplierLinks.supplierId} != ${representativeItem.supplierId}`,
            sql`${productSupplierLinks.supplierStockQty} > 0`
          )
        )
        .orderBy(supplierPrices.finalCostArs);

      supplierInfoByProductId.set(productId, {
        assignedSupplierStockQty: assignedLink?.stockQty ?? 0,
        alternatives,
      });
    })
  );

  // Consolidate rows by productId: one row per product, summing quantities and amounts.
  // Multiple rows exist when the same product was added for different WC orders.
  // Each sub-row is recorded in clientBreakdowns for per-order traceability.
  const consolidatedMap = new Map<number, {
    id: number;
    allIds: number[];
    productId: number;
    productName: string;
    productSku: string | null;
    supplierId: number;
    supplierCode: string;
    quantity: number;
    unitCostArs: number | null;
    clientPaidAmount: number | null;
    wcOrderId: number | null;
    wcOrderRef: string | null;
    goesToStock: boolean;
    stockEntryPrice: number | null;
    notes: string | null;
    stockAlertStatus: "out_of_stock" | "alt_available" | "back_in_stock" | null;
    createdAt: string;
    assignedSupplierStockQty: number;
    alternatives: { supplierId: number; supplierName: string; supplierCode: string; supplierProductCode: string; finalCostArs: number; stockQty: number }[];
    clientBreakdowns: { itemId: number; wcOrderRef: string | null; wcOrderId: number | null; quantity: number; clientPaidAmount: number | null }[];
  }>();

  for (const item of items) {
    const info = supplierInfoByProductId.get(item.productId)!;
    if (!consolidatedMap.has(item.productId)) {
      consolidatedMap.set(item.productId, {
        ...item,
        allIds: [item.id],
        assignedSupplierStockQty: info.assignedSupplierStockQty,
        alternatives: info.alternatives,
        clientBreakdowns: [{
          itemId: item.id,
          wcOrderRef: item.wcOrderRef,
          wcOrderId: item.wcOrderId,
          quantity: item.quantity,
          clientPaidAmount: item.clientPaidAmount,
        }],
      });
    } else {
      const g = consolidatedMap.get(item.productId)!;
      g.allIds.push(item.id);
      g.quantity += item.quantity;
      g.clientPaidAmount = (g.clientPaidAmount ?? 0) + (item.clientPaidAmount ?? 0);
      g.clientBreakdowns.push({
        itemId: item.id,
        wcOrderRef: item.wcOrderRef,
        wcOrderId: item.wcOrderId,
        quantity: item.quantity,
        clientPaidAmount: item.clientPaidAmount,
      });
    }
  }
  const itemsWithAlternatives = Array.from(consolidatedMap.values());

  // Margin calculation (only for closed orders)
  let margin = null;
  if (order.status === "closed" && order.totalPaid != null) {
    const cashRevenue = items.filter((i) => !i.goesToStock).reduce((s, i) => s + (i.clientPaidAmount ?? 0), 0);
    const stockValue = items.filter((i) => i.goesToStock).reduce((s, i) => s + (i.unitCostArs ?? 0) * i.quantity, 0);
    margin = {
      cashRevenue,
      stockValue,
      cost: order.totalPaid,
      cashMargin: cashRevenue - order.totalPaid,
      totalMargin: cashRevenue - order.totalPaid + stockValue,
    };
  }

  return NextResponse.json({ ...order, items: itemsWithAlternatives, margin });
}

// PATCH /api/purchases/[id] — close order or update notes
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt(params.id);
  const body = await req.json() as {
    action?: "close";
    supplierOrderNumber?: string;
    totalPaid?: number;
    notes?: string;
    stockUpdates?: { itemId: number; stockEntryPrice: number }[];
  };

  if (body.action === "close") {
    if (body.totalPaid == null) return NextResponse.json({ error: "totalPaid required" }, { status: 400 });

    // Apply stock entry prices to items if provided
    if (body.stockUpdates && body.stockUpdates.length > 0) {
      for (const u of body.stockUpdates) {
        await db
          .update(purchaseOrderItems)
          .set({ stockEntryPrice: u.stockEntryPrice })
          .where(and(eq(purchaseOrderItems.id, u.itemId), eq(purchaseOrderItems.purchaseOrderId, id)));
      }
    }

    // Update stock for items going to stock (increment localStock on products)
    const stockItems = await db
      .select()
      .from(purchaseOrderItems)
      .where(and(eq(purchaseOrderItems.purchaseOrderId, id), eq(purchaseOrderItems.goesToStock, true)));

    for (const item of stockItems) {
      await db
        .update(products)
        .set({ localStock: sql`local_stock + ${item.quantity}` })
        .where(eq(products.id, item.productId));
    }

    const [updated] = await db
      .update(purchaseOrders)
      .set({
        status: "closed",
        supplierOrderNumber: body.supplierOrderNumber ?? null,
        totalPaid: body.totalPaid,
        closedAt: new Date().toISOString(),
      })
      .where(eq(purchaseOrders.id, id))
      .returning();

    return NextResponse.json(updated);
  }

  // Simple notes update
  const [updated] = await db
    .update(purchaseOrders)
    .set({ notes: body.notes ?? null })
    .where(eq(purchaseOrders.id, id))
    .returning();

  return NextResponse.json(updated);
}

// DELETE /api/purchases/[id] — delete an open order
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user?.role === "VIEWER")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = parseInt(params.id);
  await db.delete(purchaseOrders).where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.status, "open")));
  return NextResponse.json({ ok: true });
}
