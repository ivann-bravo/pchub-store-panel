import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  supplierCatalogs,
  supplierCatalogItems,
  products,
  suppliers,
  exchangeRates,
  settings,
  dismissedMatches,
} from "@/lib/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { matchCatalogItem, getTopTokens, tokenize } from "@/lib/matching";

// Parse rawData JSON safely
function parseRawData(rawData: string | null): Record<string, unknown> {
  if (!rawData) return {};
  try {
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

// Find value in rawData with BOM-corrupted key support
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

function getSku(rawData: Record<string, unknown>): string | null {
  const val = findInRaw(rawData, ["sku", "Part Number", "part number", "SKU", "PartNumber"]);
  return val ? String(val).trim() : null;
}

function getPrice(rawData: Record<string, unknown>): number | null {
  const val = findInRaw(rawData, ["", "Precio USD", "Precio", "precio", "__col_2__"]);
  if (val === undefined || val === null) return null;
  const num = parseFloat(String(val).replace(",", "."));
  return isNaN(num) ? null : num;
}

function getStockQuantity(rawData: Record<string, unknown>): number | null {
  if (rawData.stock && typeof rawData.stock === "object") {
    const stock = rawData.stock as Record<string, number>;
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

function getSupplierCode(rawData: Record<string, unknown>): string | null {
  const val = findInRaw(rawData, ["Codigo", "Código", "codigo"]);
  return val ? String(val) : null;
}

function getExchangeRate(): number {
  // Check settings override first
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
  // Fallback to latest fetched rate
  const rate = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .get();
  return rate?.sellRate || 1;
}

// POST: Find matches for unlinked catalog items
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const body = await request.json();
    const { catalogId, page = 1, limit = 50, minScore, matchType, search } = body;

    // Get supplier info
    const supplier = db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .get();
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Determine which catalog to use
    let targetCatalogId = catalogId || null;
    if (!targetCatalogId) {
      const latest = db
        .select()
        .from(supplierCatalogs)
        .where(eq(supplierCatalogs.supplierId, supplierId))
        .orderBy(desc(supplierCatalogs.importedAt))
        .limit(1)
        .get();
      if (!latest) {
        return NextResponse.json({
          items: [],
          total: 0,
          page,
          totalPages: 0,
        });
      }
      targetCatalogId = latest.id;
    }

    // Load dismissed matches for this supplier
    const dismissedList = db
      .select()
      .from(dismissedMatches)
      .where(eq(dismissedMatches.supplierId, supplierId))
      .all();
    const dismissedMatchCodes = new Set(
      dismissedList.filter((d) => d.dismissType === "match").map((d) => d.supplierCode)
    );
    const dismissedCreateCodes = new Set(
      dismissedList.filter((d) => d.dismissType === "create").map((d) => d.supplierCode)
    );

    // Get ALL unlinked items (we filter after matching)
    const unlinkedItems = db
      .select()
      .from(supplierCatalogItems)
      .where(
        and(
          eq(supplierCatalogItems.catalogId, targetCatalogId),
          isNull(supplierCatalogItems.linkedProductId)
        )
      )
      .all();

    const xRate = getExchangeRate();
    const iibbRate = supplier.taxRate || 0;

    // === PRE-LOAD ALL DATA IN MEMORY (1 query each) ===
    type ProductRow = { id: number; name: string; sku: string | null; brand: string | null; ownPriceRegular: number | null };
    const allProducts = db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        brand: products.brand,
        ownPriceRegular: products.ownPriceRegular,
      })
      .from(products)
      .all() as ProductRow[];

    // Build SKU index for O(1) lookup
    const skuExactMap = new Map<string, ProductRow[]>();
    for (const p of allProducts) {
      if (p.sku) {
        const key = p.sku.trim().toLowerCase();
        if (!skuExactMap.has(key)) skuExactMap.set(key, []);
        skuExactMap.get(key)!.push(p);
      }
    }

    // Build word index: word -> product ids (for name token matching)
    const wordIndex = new Map<string, Set<number>>();
    const productById = new Map<number, ProductRow>();
    for (const p of allProducts) {
      productById.set(p.id, p);
      const tokens = Array.from(tokenize(p.name));
      for (const token of tokens) {
        if (token.length <= 2) continue;
        if (!wordIndex.has(token)) wordIndex.set(token, new Set());
        wordIndex.get(token)!.add(p.id);
      }
    }

    // Pre-load all supplier prices: productId -> finalCostArs
    const allPrices = db.$client.prepare(`
      SELECT psl.product_id, sp.final_cost_ars
      FROM product_supplier_links psl
      INNER JOIN supplier_prices sp ON sp.link_id = psl.id
    `).all() as { product_id: number; final_cost_ars: number }[];

    const priceByProductId = new Map<number, number>();
    for (const row of allPrices) {
      priceByProductId.set(row.product_id, row.final_cost_ars);
    }

    // Process ALL items: find best match in-memory
    const allMatchedItems = [];

    for (const item of unlinkedItems) {
      const rawData = parseRawData(item.rawData);
      const itemSku = getSku(rawData);
      const itemDescription = item.description || "";
      const itemCode = item.supplierCode || getSupplierCode(rawData) || "";
      const priceUsd = item.price ?? getPrice(rawData);
      const ivaRate = getIvaRate(rawData);
      const internalTaxRate = getInternalTaxRate(rawData);
      const stockLug = getStockQuantity(rawData);

      // Calculate ARS price — use item's actual currency, not supplier's
      const itemIsUSD = (item.currency || supplier.currency) === "USD";
      const priceArs =
        priceUsd && itemIsUSD
          ? priceUsd * (1 + ivaRate + iibbRate + internalTaxRate) * xRate
          : priceUsd || 0;

      // Strategy 1: SKU exact match via Map (O(1))
      let candidates: ProductRow[] = [];
      const itemSkuNorm = itemSku?.trim().toLowerCase() || null;

      if (itemSkuNorm) {
        candidates = skuExactMap.get(itemSkuNorm) || [];
      }

      // Strategy 1b: If no SKU in rawData, try supplierCode as SKU
      // (PC Arts and similar connectors where the internal code IS the product SKU)
      if (candidates.length === 0 && !itemSkuNorm && itemCode) {
        const codeNorm = itemCode.trim().toLowerCase();
        candidates = skuExactMap.get(codeNorm) || [];
      }

      // Strategy 2: If no SKU match, search by top tokens in-memory
      if (candidates.length === 0 && itemDescription) {
        const topWords = getTopTokens(itemDescription, 3);
        if (topWords.length > 0) {
          // Collect product ids that match ANY token
          const candidateIds = new Set<number>();
          for (const word of topWords) {
            const ids = wordIndex.get(word);
            if (ids) {
              Array.from(ids).forEach((id) => candidateIds.add(id));
            }
          }
          // Limit to 50 candidates
          let count = 0;
          const idArr = Array.from(candidateIds);
          for (const id of idArr) {
            if (count >= 50) break;
            const p = productById.get(id);
            if (p) {
              candidates.push(p);
              count++;
            }
          }
        }
      }

      // Strategy 3: SKU partial match in-memory
      const skuForPartial = itemSkuNorm || (!itemSkuNorm && itemCode ? itemCode.trim().toLowerCase() : null);
      if (candidates.length === 0 && skuForPartial) {
        let count = 0;
        for (const p of allProducts) {
          if (count >= 20) break;
          const pSku = p.sku?.trim().toLowerCase();
          if (pSku && (pSku.includes(skuForPartial) || skuForPartial.includes(pSku))) {
            candidates.push(p);
            count++;
          }
        }
      }

      // Run matching algorithm on candidates
      const bestMatch = candidates.length > 0
        ? matchCatalogItem(itemSku, itemDescription, candidates)
        : null;

      // Get product price from pre-loaded maps
      let productPrice: number | null = null;
      if (bestMatch) {
        productPrice = priceByProductId.get(bestMatch.productId) ?? null;
        if (productPrice === null) {
          const prod = productById.get(bestMatch.productId);
          if (prod?.ownPriceRegular) productPrice = prod.ownPriceRegular;
        }
      }

      allMatchedItems.push({
        catalogItemId: item.id,
        supplierCode: itemCode,
        supplierDescription: itemDescription,
        supplierSku: itemSku,
        supplierPriceUsd: priceUsd || 0,
        supplierPriceArs: priceArs,
        stockLug,
        bestMatch: bestMatch
          ? {
              productId: bestMatch.productId,
              productName: bestMatch.productName,
              productSku: bestMatch.productSku,
              productPrice,
              confidence: Math.round(bestMatch.confidence * 100) / 100,
              matchType: bestMatch.matchType,
            }
          : null,
      });
    }

    // Apply server-side filters
    let filteredItems = allMatchedItems;

    // Filter out dismissed items
    filteredItems = filteredItems.filter((item) => {
      const code = item.supplierCode;
      if (!code) return true;
      // If match was dismissed, clear the bestMatch (move to "no match")
      if (item.bestMatch && dismissedMatchCodes.has(code)) {
        item.bestMatch = null;
      }
      // If create was dismissed, hide completely
      if (!item.bestMatch && dismissedCreateCodes.has(code)) {
        return false;
      }
      return true;
    });

    // Search filter: match against supplierCode, supplierDescription, supplierSku
    if (search && typeof search === "string" && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredItems = filteredItems.filter((item) =>
        (item.supplierCode && item.supplierCode.toLowerCase().includes(q)) ||
        (item.supplierDescription && item.supplierDescription.toLowerCase().includes(q)) ||
        (item.supplierSku && item.supplierSku.toLowerCase().includes(q))
      );
    }

    if (minScore !== undefined && minScore > 0) {
      filteredItems = filteredItems.filter(
        (item) => item.bestMatch && item.bestMatch.confidence >= minScore
      );
    }

    if (matchType && matchType !== "all") {
      if (matchType === "none") {
        filteredItems = filteredItems.filter((item) => item.bestMatch === null);
      } else {
        filteredItems = filteredItems.filter(
          (item) => item.bestMatch && item.bestMatch.matchType === matchType
        );
      }
    }

    // Paginate over filtered results
    const total = filteredItems.length;
    const totalPages = Math.ceil(total / limit);
    const paginatedItems = filteredItems.slice((page - 1) * limit, page * limit);

    return NextResponse.json({
      items: paginatedItems,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    console.error("Match error:", error);
    return NextResponse.json(
      { error: "Failed to compute matches" },
      { status: 500 }
    );
  }
}
