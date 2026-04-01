import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  supplierCatalogItems,
  products,
  productSupplierLinks,
  supplierPrices,
  suppliers,
  exchangeRates,
  settings,
  priceHistory,
} from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";

function parseRawData(rawData: string | null): Record<string, unknown> {
  if (!rawData) return {};
  try {
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

function findInRaw(rawData: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (rawData[key] !== undefined && rawData[key] !== null) return rawData[key];
  }
  const rawKeys = Object.keys(rawData);
  for (const searchKey of keys) {
    if (!searchKey) continue;
    const lower = searchKey.toLowerCase();
    for (const rk of rawKeys) {
      if (rk.toLowerCase().includes(lower) || rk.toLowerCase().endsWith(lower)) {
        if (rawData[rk] !== undefined && rawData[rk] !== null) return rawData[rk];
      }
    }
  }
  return undefined;
}

function getPrice(rawData: Record<string, unknown>): number | null {
  const val = findInRaw(rawData, ["", "Precio USD", "Precio", "precio", "__col_2__"]);
  if (val === undefined || val === null) return null;
  const num = parseFloat(String(val).replace(",", "."));
  return isNaN(num) ? null : num;
}

function getSupplierCode(rawData: Record<string, unknown>): string | null {
  const val = findInRaw(rawData, ["Codigo", "Código", "codigo"]);
  return val ? String(val) : null;
}

function getStockQuantity(rawData: Record<string, unknown>): number | null {
  if (rawData.stock && typeof rawData.stock === "object") {
    const stock = rawData.stock as Record<string, number>;
    if ("nb" in stock) return stock.nb;
    if ("lug" in stock) return stock.lug;
    const values = Object.values(stock).filter((v) => typeof v === "number");
    if (values.length > 0) return values.reduce((a, b) => a + b, 0);
  }
  // stockQty: used by Ashir and other file connectors that store a numeric qty
  if (typeof rawData.stockQty === "number") return rawData.stockQty;
  const lugVal = findInRaw(rawData, ["LUG", "lug"]);
  if (lugVal !== undefined) {
    const num = parseInt(String(lugVal));
    return isNaN(num) ? null : num;
  }
  return null;
}

function getIvaRate(rawData: Record<string, unknown>): number {
  if (typeof rawData.ivaRate === "number") return rawData.ivaRate;
  const ivaVal = findInRaw(rawData, ["IVA", "iva"]);
  if (ivaVal !== undefined) {
    const num = parseFloat(String(ivaVal));
    if (!isNaN(num)) return num > 1 ? num / 100 : num;
  }
  return 0.21;
}

function getInternalTaxRate(rawData: Record<string, unknown>): number {
  if (typeof rawData.internalTaxRate === "number") return rawData.internalTaxRate;
  return 0;
}

function getExchangeRate(): number {
  const setting = db
    .select()
    .from(settings)
    .where(eq(settings.key, "exchange_rate_override"))
    .get();
  if (setting) {
    try {
      const val = JSON.parse(setting.value);
      if (typeof val === "number" && val > 0) return val;
    } catch {}
  }
  const rate = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .get();
  return rate?.sellRate || 1;
}

// POST: Bulk link catalog items to products
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const body = await request.json();
    const { links } = body as {
      links: { catalogItemId: number; productId: number }[];
    };

    if (!links || !Array.isArray(links) || links.length === 0) {
      return NextResponse.json(
        { error: "links array is required" },
        { status: 400 }
      );
    }

    // Get supplier info
    const supplier = db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .get();
    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    const iibbRate = supplier.taxRate || 0;

    let linked = 0;
    const errors: string[] = [];

    for (const { catalogItemId, productId } of links) {
      try {
        // Get the catalog item
        const item = db
          .select()
          .from(supplierCatalogItems)
          .where(eq(supplierCatalogItems.id, catalogItemId))
          .get();
        if (!item) {
          errors.push(`Catalog item ${catalogItemId} not found`);
          continue;
        }

        // Get the product (for IVA and internal tax rates)
        const product = db
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .get();
        if (!product) {
          errors.push(`Product ${productId} not found`);
          continue;
        }

        const rawData = parseRawData(item.rawData);
        const supplierCode = item.supplierCode || getSupplierCode(rawData) || "";
        const rawPrice = item.price ?? getPrice(rawData);

        // Get tax rates - prefer product values, fallback to rawData
        const ivaRate = product.ivaRate || getIvaRate(rawData);
        const internalTaxRate = product.internalTaxRate || getInternalTaxRate(rawData);

        // Create or update productSupplierLink
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

        const stockQty = getStockQuantity(rawData) ?? 0;

        if (!link) {
          link = db
            .insert(productSupplierLinks)
            .values({
              productId,
              supplierId,
              supplierCode,
              supplierStockQty: stockQty,
            })
            .returning()
            .get();
        } else {
          // Update supplier code and stock qty
          db.update(productSupplierLinks)
            .set({ supplierCode, isActive: true, supplierStockQty: stockQty })
            .where(eq(productSupplierLinks.id, link.id))
            .run();
        }

        // Use item's actual currency, not supplier's
        const itemCurrency = (item.currency || supplier.currency || "ARS") as "ARS" | "USD";
        const itemIsUSD = itemCurrency === "USD";
        const xRate = itemIsUSD ? getExchangeRate() : 1;

        // Update product's ivaRate and internalTaxRate from rawData if they differ
        const rawIvaRate = getIvaRate(rawData);
        const rawInternalTaxRate = getInternalTaxRate(rawData);
        if (product.ivaRate !== rawIvaRate || product.internalTaxRate !== rawInternalTaxRate) {
          db.update(products)
            .set({ ivaRate: rawIvaRate, internalTaxRate: rawInternalTaxRate, updatedAt: new Date().toISOString() })
            .where(eq(products.id, productId))
            .run();
        }

        // Create/update price
        if (rawPrice && rawPrice > 0) {
          const finalCostArs = itemIsUSD
            ? rawPrice * (1 + ivaRate + iibbRate + internalTaxRate) * xRate
            : rawPrice * (1 + iibbRate);

          const existingPrice = db
            .select()
            .from(supplierPrices)
            .where(eq(supplierPrices.linkId, link.id))
            .get();

          if (existingPrice) {
            db.update(supplierPrices)
              .set({
                rawPrice,
                currency: itemCurrency,
                exchangeRate: itemIsUSD ? xRate : null,
                finalCostArs,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(supplierPrices.id, existingPrice.id))
              .run();
          } else {
            db.insert(supplierPrices)
              .values({
                linkId: link.id,
                rawPrice,
                currency: itemCurrency,
                exchangeRate: itemIsUSD ? xRate : null,
                finalCostArs,
              })
              .run();
          }

          // Record price history
          db.insert(priceHistory)
            .values({
              linkId: link.id,
              rawPrice,
              currency: itemCurrency,
              exchangeRate: itemIsUSD ? xRate : null,
              finalCostArs,
            })
            .run();
        }

        // Mark catalog item as linked
        db.update(supplierCatalogItems)
          .set({
            linkedProductId: productId,
            matchConfidence: 1.0,
          })
          .where(eq(supplierCatalogItems.id, catalogItemId))
          .run();

        // Update hasSupplierStock on the product based on real stock
        const itemHasStock = item.stockAvailable === true
          || (() => {
            const qty = getStockQuantity(rawData);
            return qty !== null && qty > 0;
          })();
        db.update(products)
          .set({
            hasSupplierStock: itemHasStock,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(products.id, productId))
          .run();

        linked++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Error linking item ${catalogItemId}: ${msg}`);
      }
    }

    return NextResponse.json({ linked, errors });
  } catch (error) {
    console.error("Bulk link error:", error);
    return NextResponse.json(
      { error: "Failed to bulk link" },
      { status: 500 }
    );
  }
}
