import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  supplierCatalogs,
  supplierCatalogItems,
  products,
  productSupplierLinks,
  supplierPrices,
  suppliers,
  exchangeRates,
  settings,
} from "@/lib/db/schema";
import { eq, and, desc, isNull, sql, asc } from "drizzle-orm";
import { calculateSupplierCost } from "@/lib/pricing";

// Parse rawData JSON safely
function parseRawData(rawData: string | null): Record<string, unknown> {
  if (!rawData) return {};
  try { return JSON.parse(rawData); } catch { return {}; }
}

function getIvaRate(rawData: Record<string, unknown>): number {
  if (typeof rawData.ivaRate === "number") return rawData.ivaRate;
  return 0.21;
}

function getInternalTaxRate(rawData: Record<string, unknown>): number {
  if (typeof rawData.internalTaxRate === "number") return rawData.internalTaxRate;
  return 0;
}

function getStockQty(rawData: Record<string, unknown>): number {
  if (rawData.stock && typeof rawData.stock === "object") {
    const stock = rawData.stock as Record<string, number>;
    return stock.nb ?? stock.caba ?? stock.lug ?? 0;
  }
  // Polytech Excel format stores quantity directly as stockQty
  if (typeof rawData.stockQty === "number") return rawData.stockQty;
  return 0;
}

function getCurrentExchangeRate(): number {
  const setting = db.select().from(settings).where(eq(settings.key, "exchange_rate_override")).get();
  if (setting) {
    try {
      const val = JSON.parse(setting.value);
      if (val?.rate && typeof val.rate === "number") return val.rate;
    } catch {}
  }
  const rate = db.select().from(exchangeRates).orderBy(desc(exchangeRates.fetchedAt)).limit(1).get();
  return rate?.sellRate || 1;
}

// GET: List catalog items for linking
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const url = new URL(request.url);
    const catalogId = url.searchParams.get("catalogId");
    const status = url.searchParams.get("status"); // linked, unlinked, all
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const search = url.searchParams.get("search") || "";
    const sortBy = url.searchParams.get("sortBy") || "";
    const sortOrder = url.searchParams.get("sortOrder") || "asc";
    const stockFilter = url.searchParams.get("stockFilter") || "";

    // Get latest catalog if no specific one
    let targetCatalogId = catalogId ? parseInt(catalogId) : null;
    if (!targetCatalogId) {
      const latest = db
        .select()
        .from(supplierCatalogs)
        .where(eq(supplierCatalogs.supplierId, supplierId))
        .orderBy(desc(supplierCatalogs.importedAt))
        .limit(1)
        .get();
      if (!latest) {
        return NextResponse.json({ items: [], total: 0, catalogs: [] });
      }
      targetCatalogId = latest.id;
    }

    // Build conditions array
    const conditions = [eq(supplierCatalogItems.catalogId, targetCatalogId)];

    if (status === "linked") {
      conditions.push(sql`${supplierCatalogItems.linkedProductId} IS NOT NULL`);
    } else if (status === "unlinked") {
      conditions.push(isNull(supplierCatalogItems.linkedProductId));
    }

    if (search) {
      const searchPattern = `%${search}%`;
      conditions.push(
        sql`(${supplierCatalogItems.description} LIKE ${searchPattern} OR ${supplierCatalogItems.supplierCode} LIKE ${searchPattern} OR ${supplierCatalogItems.rawData} LIKE ${searchPattern})`
      );
    }

    if (stockFilter === "inStock") {
      conditions.push(sql`${supplierCatalogItems.stockAvailable} = 1`);
    } else if (stockFilter === "noStock") {
      conditions.push(
        sql`(${supplierCatalogItems.stockAvailable} = 0 OR ${supplierCatalogItems.stockAvailable} IS NULL)`
      );
    }

    const whereClause = and(...conditions);

    // Determine sort
    let orderClause;
    if (sortBy === "description") {
      orderClause = sortOrder === "desc" ? desc(supplierCatalogItems.description) : asc(supplierCatalogItems.description);
    } else if (sortBy === "supplierCode") {
      orderClause = sortOrder === "desc" ? desc(supplierCatalogItems.supplierCode) : asc(supplierCatalogItems.supplierCode);
    } else if (sortBy === "price") {
      orderClause = sortOrder === "desc" ? desc(supplierCatalogItems.price) : asc(supplierCatalogItems.price);
    } else {
      orderClause = asc(supplierCatalogItems.id);
    }

    const items = db
      .select()
      .from(supplierCatalogItems)
      .where(whereClause)
      .orderBy(orderClause)
      .limit(limit)
      .offset((page - 1) * limit)
      .all();

    const countResult = db
      .select({ count: sql<number>`count(*)` })
      .from(supplierCatalogItems)
      .where(whereClause)
      .get();
    const total = countResult?.count || 0;

    // Get all catalogs for this supplier
    const catalogs = db
      .select()
      .from(supplierCatalogs)
      .where(eq(supplierCatalogs.supplierId, supplierId))
      .orderBy(desc(supplierCatalogs.importedAt))
      .all();

    // Pre-fetch supplierStockQty for all linked items in one query
    const linkedCodes = items
      .filter((i) => i.supplierCode && i.linkedProductId)
      .map((i) => i.supplierCode as string);
    const stockByCode = new Map<string, number>();
    if (linkedCodes.length > 0) {
      const linkRows = db.$client
        .prepare(
          `SELECT supplier_code, supplier_stock_qty FROM product_supplier_links
           WHERE supplier_id = ? AND supplier_code IN (${linkedCodes.map(() => "?").join(",")}) AND is_active = 1`
        )
        .all(supplierId, ...linkedCodes) as { supplier_code: string; supplier_stock_qty: number }[];
      for (const r of linkRows) stockByCode.set(r.supplier_code, r.supplier_stock_qty);
    }

    // Enrich items with linked product names and real stock for linked items
    const enrichedItems = items.map((item) => {
      let linkedProduct = null;
      if (item.linkedProductId) {
        linkedProduct = db
          .select({ id: products.id, name: products.name, sku: products.sku })
          .from(products)
          .where(eq(products.id, item.linkedProductId))
          .get();
      }
      const supplierStockQty =
        item.supplierCode && stockByCode.has(item.supplierCode)
          ? stockByCode.get(item.supplierCode)!
          : null;
      return { ...item, linkedProduct, supplierStockQty };
    });

    return NextResponse.json({
      items: enrichedItems,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      catalogs,
      currentCatalogId: targetCatalogId,
    });
  } catch (error) {
    console.error("Catalog error:", error);
    return NextResponse.json({ error: "Failed to fetch catalog" }, { status: 500 });
  }
}

// POST: Link a catalog item to a product
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const body = await request.json();
    const { itemId, productId } = body;

    if (!itemId || !productId) {
      return NextResponse.json({ error: "itemId and productId required" }, { status: 400 });
    }

    // Get catalog item
    const item = db
      .select()
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemId))
      .get();
    if (!item) {
      return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
    }

    // Get supplier info for tax rate
    const supplier = db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .get();
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Get product for tax rates
    const product = db.select().from(products).where(eq(products.id, productId)).get();
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    const rawData = parseRawData(item.rawData);
    const itemCurrency = (item.currency || supplier.currency || "ARS") as "ARS" | "USD";
    const itemIsUSD = itemCurrency === "USD";

    // Get tax rates from rawData (API source of truth) with product fallback
    const ivaRate = getIvaRate(rawData);
    const internalTaxRate = getInternalTaxRate(rawData);
    const stockQty = getStockQty(rawData);

    // Update product's ivaRate and internalTaxRate from rawData if they differ
    if (product.ivaRate !== ivaRate || product.internalTaxRate !== internalTaxRate) {
      db.update(products)
        .set({ ivaRate, internalTaxRate, updatedAt: new Date().toISOString() })
        .where(eq(products.id, productId))
        .run();
    }

    // Create or update product-supplier link
    let link = db
      .select()
      .from(productSupplierLinks)
      .where(
        and(
          eq(productSupplierLinks.productId, productId),
          eq(productSupplierLinks.supplierId, supplierId)
        )
      )
      .get();

    if (!link) {
      link = db.insert(productSupplierLinks).values({
        productId,
        supplierId,
        supplierCode: item.supplierCode || "",
        supplierStockQty: stockQty,
      }).returning().get();
    } else {
      db.update(productSupplierLinks)
        .set({ supplierStockQty: stockQty })
        .where(eq(productSupplierLinks.id, link.id))
        .run();
    }

    // Create/update price if available
    if (item.price && item.price > 0) {
      // Calculate final cost in ARS using proper formula
      let finalCostArs: number;
      let xRate: number | null = null;
      if (itemIsUSD) {
        xRate = getCurrentExchangeRate();
        finalCostArs = calculateSupplierCost(item.price, ivaRate, supplier.taxRate, internalTaxRate, xRate);
      } else {
        finalCostArs = item.price * (1 + supplier.taxRate);
      }

      const existingPrice = db
        .select()
        .from(supplierPrices)
        .where(eq(supplierPrices.linkId, link.id))
        .get();

      if (existingPrice) {
        db.update(supplierPrices)
          .set({
            rawPrice: item.price,
            currency: itemCurrency,
            exchangeRate: xRate,
            finalCostArs,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(supplierPrices.id, existingPrice.id))
          .run();
      } else {
        db.insert(supplierPrices).values({
          linkId: link.id,
          rawPrice: item.price,
          currency: itemCurrency,
          exchangeRate: xRate,
          finalCostArs,
        }).run();
      }
    }

    // Mark catalog item as linked
    db.update(supplierCatalogItems)
      .set({
        linkedProductId: productId,
        matchConfidence: 1.0,
      })
      .where(eq(supplierCatalogItems.id, itemId))
      .run();

    // Update hasSupplierStock on the product based on real stock
    db.update(products)
      .set({
        hasSupplierStock: item.stockAvailable === true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, productId))
      .run();

    return NextResponse.json({ success: true, linkId: link.id });
  } catch (error) {
    console.error("Linking error:", error);
    return NextResponse.json({ error: "Failed to link product" }, { status: 500 });
  }
}

// DELETE: Unlink a catalog item from its product
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const body = await request.json();
    const { itemId } = body;

    if (!itemId) {
      return NextResponse.json({ error: "itemId required" }, { status: 400 });
    }

    // Get the catalog item to find which product it's linked to
    const item = db
      .select()
      .from(supplierCatalogItems)
      .where(eq(supplierCatalogItems.id, itemId))
      .get();

    if (!item) {
      return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
    }

    const productId = item.linkedProductId;
    if (!productId) {
      return NextResponse.json({ error: "Item is not linked" }, { status: 400 });
    }

    // Find and delete the productSupplierLink
    const link = db
      .select()
      .from(productSupplierLinks)
      .where(
        and(
          eq(productSupplierLinks.productId, productId),
          eq(productSupplierLinks.supplierId, supplierId)
        )
      )
      .get();

    if (link) {
      // Delete current price (keep priceHistory for audit trail)
      db.delete(supplierPrices).where(eq(supplierPrices.linkId, link.id)).run();
      // Delete the link
      db.delete(productSupplierLinks).where(eq(productSupplierLinks.id, link.id)).run();
    }

    // Clear linkedProductId on ALL catalog items across all catalogs of this supplier linked to this product
    db.$client
      .prepare(
        `UPDATE supplier_catalog_items
         SET linked_product_id = NULL, match_confidence = NULL
         WHERE linked_product_id = ?
         AND catalog_id IN (SELECT id FROM supplier_catalogs WHERE supplier_id = ?)`
      )
      .run(productId, supplierId);

    // Recompute hasSupplierStock: check if any other active links still have stock
    const remainingWithStock = db
      .select()
      .from(productSupplierLinks)
      .where(
        and(
          eq(productSupplierLinks.productId, productId),
          eq(productSupplierLinks.isActive, true),
          sql`${productSupplierLinks.supplierStockQty} > 0`
        )
      )
      .all();

    db.update(products)
      .set({
        hasSupplierStock: remainingWithStock.length > 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(products.id, productId))
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Unlink error:", error);
    return NextResponse.json({ error: "Failed to unlink product" }, { status: 500 });
  }
}
