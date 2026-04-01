/**
 * Product matching algorithm for imported catalog items
 */

export interface MatchCandidate {
  productId: number;
  productName: string;
  sku: string | null;
  eanUpc: string | null;
  brand: string | null;
  confidence: number;
  matchType: "exact_code" | "sku_ean" | "name_similarity" | "brand_partial" | "sku_exact" | "sku_partial";
}

/**
 * Tokenize a string for comparison: lowercase, split on non-alphanumeric, filter short tokens
 */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-záéíóúñü0-9]+/i)
      .filter((t) => t.length > 1)
  );
}

/**
 * Jaccard similarity between two token sets
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  Array.from(a).forEach((token) => {
    if (b.has(token)) intersection++;
  });
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Get the top N longest tokens from a string (useful for SQL LIKE queries)
 */
export function getTopTokens(text: string, n: number = 3): string[] {
  const tokens = Array.from(tokenize(text));
  return tokens
    .filter((t) => t.length > 2) // skip very short tokens
    .sort((a, b) => b.length - a.length)
    .slice(0, n);
}

export interface ExistingProduct {
  id: number;
  name: string;
  sku: string | null;
  eanUpc: string | null;
  brand: string | null;
  supplierCodes: { supplierId: number; supplierCode: string }[];
}

export interface CatalogItem {
  supplierCode: string;
  description: string;
}

/**
 * Match a single catalog item against a pre-filtered list of candidate products.
 * Used for batch matching where candidates are already fetched via SQL.
 */
export function matchCatalogItem(
  itemSku: string | null,
  itemDescription: string,
  candidateProducts: { id: number; name: string; sku: string | null; brand: string | null }[]
): { productId: number; productName: string; productSku: string | null; confidence: number; matchType: string } | null {
  let bestMatch: { productId: number; productName: string; productSku: string | null; confidence: number; matchType: string } | null = null;

  const itemSkuNorm = itemSku?.trim().toLowerCase() || null;
  const itemTokens = tokenize(itemDescription);

  for (const product of candidateProducts) {
    let confidence = 0;
    let matchType = "name_similarity";

    const productSkuNorm = product.sku?.trim().toLowerCase() || null;

    // 1. SKU exact match
    if (itemSkuNorm && productSkuNorm && itemSkuNorm === productSkuNorm) {
      confidence = 0.95;
      matchType = "sku_exact";
    }
    // 2. SKU partial match (one contains the other)
    else if (
      itemSkuNorm &&
      productSkuNorm &&
      (productSkuNorm.includes(itemSkuNorm) || itemSkuNorm.includes(productSkuNorm))
    ) {
      confidence = 0.85;
      matchType = "sku_partial";
    }
    // 3. Name similarity via Jaccard
    else {
      const productTokens = tokenize(product.name);
      const similarity = jaccardSimilarity(itemTokens, productTokens);

      if (similarity < 0.3) continue; // too low, skip

      confidence = Math.min(similarity, 0.8);
      matchType = "name_similarity";
    }

    // Brand bonus
    if (product.brand && itemDescription.toLowerCase().includes(product.brand.toLowerCase())) {
      confidence = Math.min(confidence + 0.05, 0.95);
    }

    if (!bestMatch || confidence > bestMatch.confidence) {
      bestMatch = {
        productId: product.id,
        productName: product.name,
        productSku: product.sku,
        confidence,
        matchType,
      };
    }
  }

  return bestMatch && bestMatch.confidence >= 0.3 ? bestMatch : null;
}

/**
 * Find matches for a catalog item against existing products (legacy, used for manual matching)
 */
export function findMatches(
  item: CatalogItem,
  products: ExistingProduct[],
  supplierId: number
): MatchCandidate[] {
  const matches: MatchCandidate[] = [];
  const itemCode = item.supplierCode?.trim();
  const itemDesc = item.description?.trim() || "";

  for (const product of products) {
    // 1. Exact code match (re-import)
    const existingLink = product.supplierCodes.find(
      (sc) => sc.supplierId === supplierId && sc.supplierCode === itemCode
    );
    if (existingLink) {
      matches.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        eanUpc: product.eanUpc,
        brand: product.brand,
        confidence: 0.99,
        matchType: "exact_code",
      });
      continue;
    }

    // 2. SKU/EAN match
    if (itemCode) {
      if (
        (product.sku && product.sku === itemCode) ||
        (product.eanUpc && product.eanUpc === itemCode)
      ) {
        matches.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          eanUpc: product.eanUpc,
          brand: product.brand,
          confidence: 0.9,
          matchType: "sku_ean",
        });
        continue;
      }
    }

    // 3. Name similarity
    if (itemDesc) {
      const itemTokens = tokenize(itemDesc);
      const productTokens = tokenize(product.name);
      let similarity = jaccardSimilarity(itemTokens, productTokens);

      // Brand bonus
      if (product.brand) {
        const brandLower = product.brand.toLowerCase();
        if (itemDesc.toLowerCase().includes(brandLower)) {
          similarity += 0.1;
        }
      }

      if (similarity >= 0.5) {
        matches.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          eanUpc: product.eanUpc,
          brand: product.brand,
          confidence: Math.min(similarity, 0.8),
          matchType: "name_similarity",
        });
        continue;
      }
    }

    // 4. Brand + partial code match
    if (itemCode && product.brand && product.sku) {
      const itemDescLower = (itemDesc || "").toLowerCase();
      const brandLower = product.brand.toLowerCase();
      if (
        itemDescLower.includes(brandLower) &&
        product.sku.includes(itemCode)
      ) {
        matches.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          eanUpc: product.eanUpc,
          brand: product.brand,
          confidence: 0.7,
          matchType: "brand_partial",
        });
      }
    }
  }

  // Sort by confidence descending
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, 5); // Top 5 matches
}
