import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotes, quoteItems, products } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { resolveAutoSlot, resolveFixedSlot } from "@/lib/combo-resolver";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// POST /api/quotes/[id]/resolve — resolves all auto/fixed slots and caches prices
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  const resolvedAt = new Date().toISOString();
  let total = 0;
  let hasAllPrices = true;

  for (const item of items) {
    if (item.itemType === "text") {
      // Text items: price is textPrice
      const price = item.textPrice ?? null;
      const effectivePrice = item.manualPrice ?? price;
      if (!item.isOptional) {
        if (effectivePrice != null) total += effectivePrice * (item.quantity ?? 1);
        else hasAllPrices = false;
      }
      continue;
    }

    if (item.itemType === "fixed" && item.fixedProductId) {
      const result = resolveFixedSlot(item.fixedProductId);

      if (result) {
        const imageUrl = db.select({ imageUrl: products.imageUrl }).from(products).where(eq(products.id, item.fixedProductId)).get()?.imageUrl ?? null;

        db.update(quoteItems).set({
          resolvedProductId: result.productId,
          resolvedProductName: result.productName,
          resolvedProductSku: result.productSku ?? null,
          resolvedImageUrl: imageUrl,
          resolvedPrice: result.clientPrice,
          resolvedHasStock: result.hasStock,
          resolvedAt,
        }).where(eq(quoteItems.id, item.id)).run();

        const effectivePrice = item.manualPrice ?? result.clientPrice;
        if (!item.isOptional) total += effectivePrice * (item.quantity ?? 1);
      } else {
        // Product exists but has no computable price
        const product = db.select().from(products).where(eq(products.id, item.fixedProductId)).get();
        if (product) {
          db.update(quoteItems).set({
            resolvedProductId: product.id,
            resolvedProductName: product.name,
            resolvedProductSku: product.sku ?? null,
            resolvedImageUrl: product.imageUrl ?? null,
            resolvedPrice: null,
            resolvedHasStock: product.localStock > 0 || product.hasSupplierStock,
            resolvedAt,
          }).where(eq(quoteItems.id, item.id)).run();
        }
        if (!item.isOptional) hasAllPrices = false;
      }
      continue;
    }

    if (item.itemType === "auto" && item.filterCategory) {
      let filterKeywords: string[] = [];
      let filterMustKeywords: string[] = [];
      let filterAttributes: Record<string, string> = {};

      try { filterKeywords = JSON.parse(item.filterKeywords ?? "[]"); } catch { /* ignore */ }
      try { filterMustKeywords = JSON.parse(item.filterMustKeywords ?? "[]"); } catch { /* ignore */ }
      try { filterAttributes = JSON.parse(item.filterAttributes ?? "{}"); } catch { /* ignore */ }

      const result = resolveAutoSlot(
        item.filterCategory,
        filterKeywords,
        filterAttributes,
        filterMustKeywords,
        item.filterMinPrice ?? undefined,
        item.filterMaxPrice ?? undefined,
      );

      if (result) {
        db.update(quoteItems).set({
          resolvedProductId: result.productId,
          resolvedProductName: result.productName,
          resolvedProductSku: result.productSku ?? null,
          resolvedPrice: result.clientPrice,
          resolvedHasStock: result.hasStock,
          resolvedAt,
          // Fetch image from products table
          resolvedImageUrl: db.select({ imageUrl: products.imageUrl }).from(products).where(eq(products.id, result.productId)).get()?.imageUrl ?? null,
        }).where(eq(quoteItems.id, item.id)).run();

        const effectivePrice = item.manualPrice ?? result.clientPrice;
        if (!item.isOptional) total += effectivePrice * (item.quantity ?? 1);
      } else {
        db.update(quoteItems).set({
          resolvedProductId: null,
          resolvedProductName: null,
          resolvedProductSku: null,
          resolvedPrice: null,
          resolvedHasStock: false,
          resolvedAt,
        }).where(eq(quoteItems.id, item.id)).run();
        if (!item.isOptional) hasAllPrices = false;
      }
    }
  }

  // Update quote total
  db.update(quotes).set({
    resolvedTotal: hasAllPrices ? total : null,
    resolvedAt,
    updatedAt: resolvedAt,
  }).where(eq(quotes.id, id)).run();

  const updatedItems = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  return NextResponse.json({
    resolvedAt,
    resolvedTotal: hasAllPrices ? total : null,
    items: updatedItems,
  });
}
