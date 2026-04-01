import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, productSupplierLinks } from "@/lib/db/schema";
import { eq, and, inArray } from "drizzle-orm";

/**
 * Checks stock availability for all items in open purchase orders and updates
 * their stockAlertStatus column.
 *
 * Status values:
 *   null            — assigned supplier has stock, no issue
 *   'out_of_stock'  — assigned supplier has no stock AND no alternative supplier has stock
 *   'alt_available' — assigned supplier has no stock BUT another supplier has stock
 *   'back_in_stock' — was flagged (out_of_stock or alt_available), now the assigned supplier has stock again
 *
 * 'back_in_stock' persists until the user explicitly dismisses it (sets to null).
 */
export function refreshPurchaseOrderStockAlerts(): number {
  // Fetch all items in open purchase orders
  const openItems = db
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      supplierId: purchaseOrderItems.supplierId,
      currentStatus: purchaseOrderItems.stockAlertStatus,
    })
    .from(purchaseOrderItems)
    .innerJoin(
      purchaseOrders,
      and(
        eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId),
        eq(purchaseOrders.status, "open")
      )
    )
    .all();

  if (openItems.length === 0) return 0;

  // Fetch all active supplier links for the relevant products
  const productIds = Array.from(new Set(openItems.map((i) => i.productId)));
  const stockLinks = db
    .select({
      productId: productSupplierLinks.productId,
      supplierId: productSupplierLinks.supplierId,
      stockQty: productSupplierLinks.supplierStockQty,
    })
    .from(productSupplierLinks)
    .where(
      and(
        eq(productSupplierLinks.isActive, true),
        inArray(productSupplierLinks.productId, productIds)
      )
    )
    .all();

  // Build a map: `${productId}:${supplierId}` → stockQty (for assigned supplier lookups)
  const assignedStockMap = new Map<string, number>();
  for (const link of stockLinks) {
    assignedStockMap.set(`${link.productId}:${link.supplierId}`, link.stockQty ?? 0);
  }

  let updated = 0;

  for (const item of openItems) {
    const assignedStock = assignedStockMap.get(`${item.productId}:${item.supplierId}`) ?? 0;

    // Check if any OTHER supplier has stock for this product
    const hasAlternative = stockLinks.some(
      (l) => l.productId === item.productId && l.supplierId !== item.supplierId && (l.stockQty ?? 0) > 0
    );

    let newStatus: "out_of_stock" | "alt_available" | "back_in_stock" | null;

    if (assignedStock > 0) {
      if (item.currentStatus === "out_of_stock" || item.currentStatus === "alt_available") {
        // Was flagged, now the assigned supplier has stock again
        newStatus = "back_in_stock";
      } else {
        // Keep existing status (null or back_in_stock pending dismiss)
        newStatus = item.currentStatus ?? null;
      }
    } else {
      // Assigned supplier has no stock
      newStatus = hasAlternative ? "alt_available" : "out_of_stock";
    }

    if (newStatus !== (item.currentStatus ?? null)) {
      db.update(purchaseOrderItems)
        .set({ stockAlertStatus: newStatus })
        .where(eq(purchaseOrderItems.id, item.id))
        .run();
      updated++;
    }
  }

  return updated;
}
