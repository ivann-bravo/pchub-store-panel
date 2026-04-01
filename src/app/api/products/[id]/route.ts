import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  products,
  productSupplierLinks,
  suppliers,
  supplierPrices,
  priceHistory,
  productPriceHistory,
  wooCategories,
} from "@/lib/db/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const productId = parseInt(params.id, 10);
    if (isNaN(productId)) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    // Get the product
    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId));

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Get supplier links with supplier info and prices
    const links = await db
      .select({
        link: productSupplierLinks,
        supplier: suppliers,
      })
      .from(productSupplierLinks)
      .innerJoin(suppliers, eq(productSupplierLinks.supplierId, suppliers.id))
      .where(eq(productSupplierLinks.productId, productId));

    // For each link, get its latest price and price history
    const supplierLinks = await Promise.all(
      links.map(async ({ link, supplier }) => {
        const [price] = await db
          .select()
          .from(supplierPrices)
          .where(eq(supplierPrices.linkId, link.id))
          .limit(1);

        const history = await db
          .select()
          .from(priceHistory)
          .where(eq(priceHistory.linkId, link.id))
          .orderBy(desc(priceHistory.recordedAt))
          .limit(100);

        return {
          ...link,
          supplier,
          price: price ?? null,
          priceHistory: history,
        };
      })
    );

    // Get own price history
    const ownPriceHistory = await db
      .select()
      .from(productPriceHistory)
      .where(eq(productPriceHistory.productId, productId))
      .orderBy(desc(productPriceHistory.recordedAt))
      .limit(100);

    // Resolve WooCommerce category names from stored IDs
    let wooCategoryNames: string[] = [];
    if (product.wooCategoryIds) {
      try {
        const ids: number[] = JSON.parse(product.wooCategoryIds);
        if (ids.length > 0) {
          const cats = await db.select({ wooId: wooCategories.wooId, name: wooCategories.name, parentId: wooCategories.parentId })
            .from(wooCategories)
            .where(inArray(wooCategories.wooId, ids));
          // Topological sort: root → leaf (parent → child order for breadcrumb)
          const idsSet = new Set(ids);
          const sorted: string[] = [];
          const visited = new Set<number>();
          // Start from root: category whose parentId is 0 or not in our set
          let current = cats.find((c) => c.parentId === 0 || !idsSet.has(c.parentId));
          while (current && !visited.has(current.wooId)) {
            sorted.push(current.name);
            visited.add(current.wooId);
            const next = cats.find((c) => c.parentId === current!.wooId && !visited.has(c.wooId));
            current = next;
          }
          // Add any remaining (disconnected) categories
          for (const c of cats) {
            if (!visited.has(c.wooId)) sorted.push(c.name);
          }
          wooCategoryNames = sorted;
        }
      } catch {}
    }

    return NextResponse.json({
      ...product,
      supplierLinks,
      ownPriceHistory,
      wooCategoryNames,
    });
  } catch (error) {
    console.error("GET /api/products/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch product" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const productId = parseInt(params.id, 10);
    if (isNaN(productId)) {
      return NextResponse.json({ error: "Invalid product ID" }, { status: 400 });
    }

    const rawBody = await request.json();

    // Whitelist of allowed fields
    const allowedFields = new Set([
      "name", "sku", "eanUpc", "category", "brand", "warranty",
      "ivaRate", "internalTaxRate", "markupRegular", "markupOffer",
      "ownPriceRegular", "ownPriceOffer", "ownCostUsd",
      "localStock", "weightKg", "lengthCm", "widthCm", "heightCm",
      "imageUrl", "storeUrl", "woocommerceId", "wooCategoryIds", "productTags", "shortDescription", "description",
      "wooManualPrivate",
    ]);
    const body: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawBody)) {
      if (allowedFields.has(key)) {
        body[key] = value;
      }
    }

    // Get existing product to check for price changes
    const [existing] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId));

    if (!existing) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Check if own prices are being changed
    const priceChanged =
      (body.ownPriceRegular !== undefined && body.ownPriceRegular !== existing.ownPriceRegular) ||
      (body.ownPriceOffer !== undefined && body.ownPriceOffer !== existing.ownPriceOffer);

    // Mark wooSyncPending when pricing/stock fields change (if the product has a WC ID)
    const wooRelevantFields = new Set(["ownPriceRegular", "ownPriceOffer", "localStock", "markupRegular", "markupOffer", "ivaRate", "wooManualPrivate"]);
    const wooRelevantChanged = existing.woocommerceId != null &&
      Object.keys(body).some((k) => wooRelevantFields.has(k));

    // Update with current timestamp
    await db
      .update(products)
      .set({
        ...(body as Record<string, unknown> & Partial<typeof products.$inferInsert>),
        ...(wooRelevantChanged ? { wooSyncPending: true } : {}),
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(products.id, productId));

    // Record price history if prices changed
    if (priceChanged) {
      const newRegular = (body.ownPriceRegular !== undefined ? body.ownPriceRegular : existing.ownPriceRegular) as number | null;
      const newOffer = (body.ownPriceOffer !== undefined ? body.ownPriceOffer : existing.ownPriceOffer) as number | null;

      await db.insert(productPriceHistory).values({
        productId,
        priceRegular: newRegular,
        priceOffer: newOffer,
      });
    }

    // Return updated product
    const [updated] = await db
      .select()
      .from(products)
      .where(eq(products.id, productId));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/products/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update product" },
      { status: 500 }
    );
  }
}
