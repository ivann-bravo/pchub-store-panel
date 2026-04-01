/**
 * Pricing Engine
 *
 * Global markup application + smart offer detection.
 * Pure synchronous functions using better-sqlite3 via db.$client.
 * Safe to call from API routes — no HTTP dependencies.
 */
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface PricingSettings {
  globalMarkup: number;
  offerMode: "normal" | "event";
  offerGlobalStart: string; // ISO date string (YYYY-MM-DD)
  offerGlobalEnd: string;   // ISO date string (YYYY-MM-DD)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function twoYearsIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 2);
  return d.toISOString().slice(0, 10);
}

const DEFAULTS: PricingSettings = {
  globalMarkup: 1.10,
  offerMode: "normal",
  offerGlobalStart: todayIso(),
  offerGlobalEnd: twoYearsIso(),
};

export function getPricingSettings(): PricingSettings {
  const rows = db.select().from(settings).all();
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    globalMarkup:
      map["global_markup"] !== undefined
        ? parseFloat(JSON.parse(map["global_markup"]))
        : DEFAULTS.globalMarkup,
    offerMode:
      map["offer_mode"] !== undefined
        ? JSON.parse(map["offer_mode"])
        : DEFAULTS.offerMode,
    offerGlobalStart:
      map["offer_global_start"] !== undefined
        ? JSON.parse(map["offer_global_start"])
        : DEFAULTS.offerGlobalStart,
    offerGlobalEnd:
      map["offer_global_end"] !== undefined
        ? JSON.parse(map["offer_global_end"])
        : DEFAULTS.offerGlobalEnd,
  };
}

export function savePricingSettings(partial: Partial<PricingSettings>): void {
  const kvMap: Record<string, string> = {};
  if (partial.globalMarkup !== undefined)
    kvMap["global_markup"] = JSON.stringify(partial.globalMarkup);
  if (partial.offerMode !== undefined)
    kvMap["offer_mode"] = JSON.stringify(partial.offerMode);
  if (partial.offerGlobalStart !== undefined)
    kvMap["offer_global_start"] = JSON.stringify(partial.offerGlobalStart);
  if (partial.offerGlobalEnd !== undefined)
    kvMap["offer_global_end"] = JSON.stringify(partial.offerGlobalEnd);

  const stmt = db.$client.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const [key, value] of Object.entries(kvMap)) {
    stmt.run(key, value);
  }
}

// ─── Apply Global Markup ──────────────────────────────────────────────────────

/**
 * Batch-update markup_regular = globalMarkup for all eligible products.
 * Excluded:
 *   - Brand Evolabs / EVOLABS
 *   - SKU starting with PCTRY
 *   - Products with markup_regular = 1.0 (special products)
 */
export function applyGlobalMarkup(): { updated: number } {
  const { globalMarkup } = getPricingSettings();

  const result = db.$client
    .prepare(
      `UPDATE products
       SET markup_regular = ?, updated_at = datetime('now')
       WHERE (brand NOT IN ('Evolabs', 'EVOLABS') OR brand IS NULL)
         AND (sku NOT LIKE 'PCTRY%' OR sku IS NULL)
         AND markup_regular != 1.0`
    )
    .run(globalMarkup);

  return { updated: result.changes };
}

// ─── Token extraction ─────────────────────────────────────────────────────────

const CHIPSET_TOKENS = [
  "A520", "A620", "B450", "B550", "B650", "B650E", "X570", "X670", "X870",
  "H410", "H510", "H610", "H810", "B460", "B560", "B660", "B760",
  "Z490", "Z590", "Z690", "Z790", "Z890",
];
const SOCKET_TOKENS = ["AM4", "AM5"];
const INTEL_SOCKET_TOKENS = ["1200", "1151", "1700", "1851"];

interface TokenizedProduct {
  chipset: string | null;
  gpuModel: string | null;
  capacity: string | null;
  memType: string | null;
  storageType: string | null;
}

function extractTokens(name: string): TokenizedProduct {
  const upper = name.toUpperCase();

  const chipset = CHIPSET_TOKENS.find((t) => upper.includes(t)) ?? null;

  const gpuMatch = /\b(RTX|GTX|RX)\s*(\d{3,4}[A-Z]*)/i.exec(name);
  const gpuModel = gpuMatch
    ? `${gpuMatch[1].toUpperCase()}${gpuMatch[2].toUpperCase()}`
    : null;

  const capMatch = /\b(\d+)(GB|TB)\b/i.exec(name);
  const capacity = capMatch
    ? `${capMatch[1]}${capMatch[2].toUpperCase()}`
    : null;

  const memType = upper.includes("DDR5")
    ? "DDR5"
    : upper.includes("DDR4")
    ? "DDR4"
    : null;

  const storageType =
    upper.includes("NVME") || upper.includes("M.2") || upper.includes("PCIE")
      ? "NVME"
      : upper.includes("SATA")
      ? "SATA"
      : null;

  return { chipset, gpuModel, capacity, memType, storageType };
}

function getGroupKey(name: string, category: string): string {
  const { chipset, gpuModel, capacity, memType, storageType } =
    extractTokens(name);
  const upper = name.toUpperCase();
  const cat = (category || "").toUpperCase();

  // Check socket tokens for motherboards
  const socket =
    SOCKET_TOKENS.find((t) => upper.includes(t)) ??
    INTEL_SOCKET_TOKENS.find((t) => upper.includes(t)) ??
    null;

  // RAM
  if (
    cat.includes("RAM") ||
    cat.includes("MEMO") ||
    cat.includes("MEMORIA")
  ) {
    if (memType && capacity) return `${memType}_${capacity}`;
    if (capacity) return `RAM_${capacity}`;
  }

  // SSD / Storage
  if (
    cat.includes("SSD") ||
    cat.includes("ALMACEN") ||
    cat.includes("DISCO") ||
    cat.includes("STORAGE") ||
    cat.includes("UNIDAD")
  ) {
    if (storageType && capacity) return `${storageType}_${capacity}`;
    if (capacity) return `STORAGE_${capacity}`;
  }

  // GPU
  if (
    cat.includes("GPU") ||
    cat.includes("VIDEO") ||
    cat.includes("VGA") ||
    cat.includes("PLACA DE VIDEO")
  ) {
    if (gpuModel) return `GPU_${gpuModel}`;
  }

  // Motherboard
  if (
    cat.includes("MOTHER") ||
    cat.includes("PLACA MADRE") ||
    cat.includes("MAINBOARD")
  ) {
    if (chipset) return `MB_${chipset}`;
    if (socket) return `MB_${socket}`;
  }

  // Priority fallback across categories
  if (gpuModel) return `GPU_${gpuModel}`;
  if (chipset) return `MB_${chipset}`;
  if (memType && capacity) return `${memType}_${capacity}`;
  if (storageType && capacity) return `${storageType}_${capacity}`;
  if (capacity) return `CAP_${capacity}`;

  return `catchall:${category}`;
}

// ─── Offer Detection ──────────────────────────────────────────────────────────

export interface OfferDetectionResult {
  offersAdded: number;
  offersRemoved: number;
  skipped: number;
  groups: number;
}

interface EligibleProduct {
  id: number;
  name: string;
  category: string | null;
  markup_regular: number;
  markup_offer: number | null;
  offer_start: string | null;
  offer_end: string | null;
  best_cost_ars: number;
}

/**
 * Detect offers: within each group of similar products (same category + group key),
 * put the cheapest ones on offer using "fictitious" prices.
 *
 * Excluded from detection:
 *   - Products with own_price_regular (manual price)
 *   - Brand Evolabs / EVOLABS
 *   - SKU starting with PCTRY
 *   - Products with markup_regular = 1.0
 */
export function runOfferDetection(): OfferDetectionResult {
  const pricingSettings = getPricingSettings();

  const { globalMarkup, offerMode, offerGlobalStart, offerGlobalEnd } =
    pricingSettings;

  // Query all eligible products with best supplier cost
  const rows = db.$client
    .prepare(
      `SELECT
         p.id,
         p.name,
         p.category,
         p.markup_regular,
         p.markup_offer,
         p.offer_start,
         p.offer_end,
         MIN(sp.final_cost_ars) AS best_cost_ars
       FROM products p
       JOIN product_supplier_links psl ON psl.product_id = p.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
       JOIN supplier_prices sp ON sp.link_id = psl.id
       WHERE p.own_price_regular IS NULL
         AND (p.brand NOT IN ('Evolabs', 'EVOLABS') OR p.brand IS NULL)
         AND (p.sku NOT LIKE 'PCTRY%' OR p.sku IS NULL)
         AND p.markup_regular != 1.0
       GROUP BY p.id
       HAVING best_cost_ars IS NOT NULL`
    )
    .all() as EligibleProduct[];

  // Track currently offered products (to detect removals)
  const currentlyOnOffer = new Set(
    rows.filter((r) => r.markup_offer !== null).map((r) => r.id)
  );

  // Build category → products record
  const categoryRecord: Record<string, EligibleProduct[]> = {};
  for (const row of rows) {
    const cat = row.category || "__none__";
    if (!categoryRecord[cat]) categoryRecord[cat] = [];
    categoryRecord[cat].push(row);
  }

  let offersAdded = 0;
  let offersRemoved = 0;
  let skipped = 0;
  let totalGroups = 0;

  const newOfferIds: number[] = [];

  const updateOfferStmt = db.$client.prepare(
    `UPDATE products
     SET markup_offer = ?,
         markup_regular = ?,
         offer_start = ?,
         offer_end = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  );

  type WithPrice = EligibleProduct & { basePrice: number };

  for (const category of Object.keys(categoryRecord)) {
    const catProducts = categoryRecord[category];

    // Build group key → products record within category
    const groupRecord: Record<string, EligibleProduct[]> = {};
    for (const product of catProducts) {
      const key = getGroupKey(
        product.name,
        category === "__none__" ? "" : category
      );
      if (!groupRecord[key]) groupRecord[key] = [];
      groupRecord[key].push(product);
    }

    for (const groupKey of Object.keys(groupRecord)) {
      const group = groupRecord[groupKey];

      if (group.length < 2) {
        skipped += group.length;
        continue;
      }

      totalGroups++;

      // Calculate base prices using globalMarkup
      const withPrices: WithPrice[] = group.map((p: EligibleProduct) => ({
        ...p,
        basePrice: p.best_cost_ars * globalMarkup,
      }));

      const groupAvg =
        withPrices.reduce((sum: number, p: WithPrice) => sum + p.basePrice, 0) /
        withPrices.length;

      // Threshold and cap depend on mode
      const threshold =
        offerMode === "event" ? groupAvg * 1.1 : groupAvg;
      const capRatio = offerMode === "event" ? 0.65 : 0.4;

      // Find candidates below threshold
      const candidates = withPrices.filter((p: WithPrice) => p.basePrice < threshold);
      if (candidates.length === 0) continue;

      // Cap: max N products
      const cap = Math.min(
        Math.ceil(group.length * capRatio),
        candidates.length
      );

      // Sort by ratio DESC (greatest price advantage first)
      candidates.sort(
        (a: WithPrice, b: WithPrice) => groupAvg / b.basePrice - groupAvg / a.basePrice
      );

      const selected = candidates.slice(0, cap);

      for (const candidate of selected) {
        const ratio = groupAvg / candidate.basePrice;
        const rawPct = (ratio - 1) * 100;
        const offerPct = Math.min(
          40,
          Math.max(5, Math.round(rawPct / 5) * 5)
        );

        const newMarkupRegular = globalMarkup * (1 + offerPct / 100);

        updateOfferStmt.run(
          globalMarkup,       // markup_offer (= sale price multiplier)
          newMarkupRegular,   // markup_regular (= crossed-out price multiplier)
          offerGlobalStart,
          offerGlobalEnd,
          candidate.id
        );

        newOfferIds.push(candidate.id);

        if (!currentlyOnOffer.has(candidate.id)) {
          offersAdded++;
        }
      }
    }
  }

  // Remove offers from products that no longer qualify
  const removeOfferStmt = db.$client.prepare(
    `UPDATE products
     SET markup_offer = NULL,
         offer_start = NULL,
         offer_end = NULL,
         markup_regular = ?,
         updated_at = datetime('now')
     WHERE id = ?`
  );

  const newOfferSet = new Set(newOfferIds);
  Array.from(currentlyOnOffer).forEach((id: number) => {
    if (!newOfferSet.has(id)) {
      removeOfferStmt.run(globalMarkup, id);
      offersRemoved++;
    }
  });

  return { offersAdded, offersRemoved, skipped, groups: totalGroups };
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

export interface ProductWithoutPrice {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  localStock: number;
}

/**
 * Products with local physical stock but no own_price_regular set.
 * These need a manual price since the markup system won't cover them
 * without a supplier price either.
 */
export function getOwnStockWithoutPrice(): ProductWithoutPrice[] {
  return db.$client
    .prepare(
      `SELECT id, name, sku, category, local_stock AS localStock
       FROM products
       WHERE local_stock > 0
         AND own_price_regular IS NULL
         AND (sku NOT LIKE 'PCTRY%' OR sku IS NULL)
       ORDER BY local_stock DESC, name ASC`
    )
    .all() as ProductWithoutPrice[];
}

// ─── Preview helpers ──────────────────────────────────────────────────────────

export interface PricingPreview {
  eligibleForMarkup: number;
  currentlyOnOffer: number;
  ownStockWithoutPrice: number;
  discountDistribution: { pct: number; count: number }[];
}

export function getPricingPreview(): PricingPreview {
  const eligibleForMarkup = (
    db.$client
      .prepare(
        `SELECT COUNT(*) AS cnt FROM products
         WHERE (brand NOT IN ('Evolabs', 'EVOLABS') OR brand IS NULL)
           AND (sku NOT LIKE 'PCTRY%' OR sku IS NULL)
           AND markup_regular != 1.0`
      )
      .get() as { cnt: number }
  ).cnt;

  const currentlyOnOffer = (
    db.$client
      .prepare(
        `SELECT COUNT(*) AS cnt FROM products
         WHERE markup_offer IS NOT NULL
           AND offer_start IS NOT NULL AND offer_end IS NOT NULL
           AND offer_start <= datetime('now') AND offer_end >= datetime('now')`
      )
      .get() as { cnt: number }
  ).cnt;

  const ownStockWithoutPrice = (
    db.$client
      .prepare(
        `SELECT COUNT(*) AS cnt FROM products
         WHERE local_stock > 0
           AND own_price_regular IS NULL
           AND (sku NOT LIKE 'PCTRY%' OR sku IS NULL)`
      )
      .get() as { cnt: number }
  ).cnt;

  // Discount distribution: percentage difference between markup_regular and markup_offer
  // offer_pct = round((markup_regular / markup_offer - 1) * 100 / 5) * 5
  const distRows = db.$client
    .prepare(
      `SELECT
         CAST(ROUND((markup_regular / markup_offer - 1) * 100 / 5) * 5 AS INTEGER) AS pct,
         COUNT(*) AS cnt
       FROM products
       WHERE markup_offer IS NOT NULL
         AND offer_start IS NOT NULL AND offer_end IS NOT NULL
         AND offer_start <= datetime('now') AND offer_end >= datetime('now')
       GROUP BY pct
       ORDER BY pct ASC`
    )
    .all() as { pct: number; cnt: number }[];

  return {
    eligibleForMarkup,
    currentlyOnOffer,
    ownStockWithoutPrice,
    discountDistribution: distRows.map((r) => ({ pct: r.pct, count: r.cnt })),
  };
}
