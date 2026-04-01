/**
 * Combo Resolver
 *
 * Pure functions for resolving combo slots to the cheapest matching products
 * and refreshing combo templates. Called from API routes — no HTTP dependencies.
 */
import { db } from "@/lib/db";
import { comboTemplates, comboSlots, products, productPriceHistory, productSupplierLinks, buscadorItems } from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import type {
  ComboResolutionResult,
  SlotResolutionResult,
} from "@/types";

// ─── Resolution helpers ───────────────────────────────────────────────────────

interface ResolvedProduct {
  productId: number;
  productName: string;
  productSku: string | null;
  clientPrice: number;
  regularPrice: number | null;
  isOnOffer: boolean;
  hasStock: boolean;
}

/**
 * Find the cheapest in-stock product matching a category + keyword filters + optional attributes.
 * Uses db.$client (better-sqlite3 synchronous API) for dynamic conditions.
 *
 * Price: MIN(supplier_prices.final_cost_ars) * products.markup_regular
 *        Falls back to products.own_price_regular if no supplier prices exist.
 *
 * filterMustKeywords: ALL must appear in product name (AND) — e.g. ["8GB"] for capacity
 * filterKeywords:     ANY can appear in product name (OR)  — e.g. ["B660","B760"] or ["RGB","Fury"]
 * filterAttributes:   e.g. { memoryType: "DDR4", socket: "1700" }
 * Products without attributes will be excluded when filterAttributes is non-empty.
 */
export function resolveAutoSlot(
  filterCategory: string,
  filterKeywords: string[],
  filterAttributes?: Record<string, string>,
  filterMustKeywords?: string[],
  filterMinPrice?: number | null,
  filterMaxPrice?: number | null
): ResolvedProduct | null {
  // Must keywords → second OR group, ANDed with the first (any can match within the group)
  const mustParams = (filterMustKeywords ?? []).map((kw) => `%${kw}%`);
  const mustClauses =
    (filterMustKeywords ?? []).length === 0
      ? ""
      : filterMustKeywords!.length === 1
      ? `AND UPPER(p.name) LIKE UPPER(?)`
      : `AND (${filterMustKeywords!.map(() => `UPPER(p.name) LIKE UPPER(?)`).join(" OR ")})`;

  // Any keywords → OR clause (any can match)
  const keywordParams = filterKeywords.map((kw) => `%${kw}%`);
  const keywordClauses =
    filterKeywords.length === 0
      ? ""
      : filterKeywords.length === 1
      ? `AND UPPER(p.name) LIKE UPPER(?)`
      : `AND (${filterKeywords.map(() => `UPPER(p.name) LIKE UPPER(?)`).join(" OR ")})`;

  const attrEntries = Object.entries(filterAttributes ?? {});
  const attrClauses = attrEntries
    .map(([key]) => `AND JSON_EXTRACT(p.attributes, '$.${key}') = ?`)
    .join("\n      ");
  const attrParams = attrEntries.map(([, v]) => v);

  // Price range clauses — applied on the computed client_price via a candidates CTE
  const minPriceClause = filterMinPrice != null ? `AND client_price >= ?` : "";
  const maxPriceClause = filterMaxPrice != null ? `AND client_price <= ?` : "";
  const priceParams: number[] = [
    ...(filterMinPrice != null ? [filterMinPrice] : []),
    ...(filterMaxPrice != null ? [filterMaxPrice] : []),
  ];

  const query = `
    WITH ranked_prices AS (
      SELECT
        psl.product_id,
        sp.final_cost_ars,
        psl.supplier_stock_qty,
        ROW_NUMBER() OVER (
          PARTITION BY psl.product_id
          ORDER BY sp.final_cost_ars ASC
        ) AS rn
      FROM product_supplier_links psl
      JOIN supplier_prices sp ON sp.link_id = psl.id
      WHERE psl.is_active = 1 AND psl.supplier_stock_qty > 0
    ),
    best_supplier_prices AS (
      SELECT
        r.product_id,
        r.final_cost_ars AS best_cost_ars,
        (SELECT MAX(psl2.supplier_stock_qty)
         FROM product_supplier_links psl2
         WHERE psl2.product_id = r.product_id AND psl2.is_active = 1) AS max_link_stock
      FROM ranked_prices r
      WHERE r.rn = 1
    ),
    candidates AS (
      SELECT
        p.id              AS product_id,
        p.name            AS product_name,
        p.sku             AS product_sku,
        p.markup_regular,
        p.own_price_regular,
        p.own_price_offer,
        p.has_supplier_stock,
        p.local_stock,
        bsp.best_cost_ars,
        bsp.max_link_stock,
        -- Effective client price: same logic as products page display_price
        CASE
          WHEN p.own_price_offer IS NOT NULL
            THEN p.own_price_offer
          WHEN p.own_price_regular IS NOT NULL
            THEN p.own_price_regular
          WHEN bsp.best_cost_ars IS NOT NULL
            AND p.markup_offer IS NOT NULL
            AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
            AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
            THEN bsp.best_cost_ars * p.markup_offer
          WHEN bsp.best_cost_ars IS NOT NULL
            THEN bsp.best_cost_ars * p.markup_regular
          ELSE NULL
        END AS client_price,
        -- Regular price (without offer)
        CASE
          WHEN p.own_price_regular IS NOT NULL THEN p.own_price_regular
          WHEN bsp.best_cost_ars IS NOT NULL THEN bsp.best_cost_ars * p.markup_regular
          ELSE NULL
        END AS regular_price,
        -- Is offer active?
        CASE
          WHEN (p.markup_offer IS NOT NULL OR p.own_price_offer IS NOT NULL)
            AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
            AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
            THEN 1 ELSE 0
        END AS is_on_offer
      FROM products p
      LEFT JOIN best_supplier_prices bsp ON bsp.product_id = p.id
      WHERE p.category = ?
        ${mustClauses}
        ${keywordClauses}
        ${attrClauses}
        -- Stock: accept if local stock, has_supplier_stock flag, OR supplier link has qty > 0
        AND (p.local_stock > 0 OR p.has_supplier_stock = 1 OR COALESCE(bsp.max_link_stock, 0) > 0)
        AND (
          p.own_price_offer IS NOT NULL
          OR p.own_price_regular IS NOT NULL
          OR bsp.best_cost_ars IS NOT NULL
        )
    )
    SELECT * FROM candidates
    WHERE client_price IS NOT NULL
      ${minPriceClause}
      ${maxPriceClause}
    ORDER BY client_price ASC
    LIMIT 1
  `;

  const params = [filterCategory, ...mustParams, ...keywordParams, ...attrParams, ...priceParams];

  const row = db.$client.prepare(query).get(...params) as {
    product_id: number;
    product_name: string;
    product_sku: string | null;
    markup_regular: number;
    own_price_regular: number | null;
    has_supplier_stock: number;
    local_stock: number;
    best_cost_ars: number | null;
    max_link_stock: number | null;
    client_price: number | null;
    regular_price: number | null;
    is_on_offer: number;
  } | undefined;

  if (!row || row.client_price === null) return null;

  return {
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    clientPrice: Math.round(row.client_price * 100) / 100,
    regularPrice: row.regular_price !== null ? Math.round(row.regular_price * 100) / 100 : null,
    isOnOffer: row.is_on_offer === 1,
    hasStock: Boolean(row.has_supplier_stock) || row.local_stock > 0 || (row.max_link_stock ?? 0) > 0,
  };
}

/**
 * Get the current best price for a specific product (fixed slot).
 */
export function resolveFixedSlot(productId: number): ResolvedProduct | null {
  const query = `
    SELECT
      p.id              AS product_id,
      p.name            AS product_name,
      p.sku             AS product_sku,
      p.markup_regular,
      p.own_price_regular,
      p.own_price_offer,
      p.has_supplier_stock,
      p.local_stock,
      MIN(sp.final_cost_ars) AS best_cost_ars,
      MAX(psl.supplier_stock_qty) AS max_link_stock,
      -- Same logic as products page display_price
      CASE
        WHEN p.own_price_offer IS NOT NULL
          THEN p.own_price_offer
        WHEN p.own_price_regular IS NOT NULL
          THEN p.own_price_regular
        WHEN MIN(sp.final_cost_ars) IS NOT NULL
          AND p.markup_offer IS NOT NULL
          AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
          AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
          THEN MIN(sp.final_cost_ars) * p.markup_offer
        WHEN MIN(sp.final_cost_ars) IS NOT NULL
          THEN MIN(sp.final_cost_ars) * p.markup_regular
        ELSE NULL
      END AS client_price,
      -- Regular price (without offer)
      CASE
        WHEN p.own_price_regular IS NOT NULL THEN p.own_price_regular
        WHEN MIN(sp.final_cost_ars) IS NOT NULL THEN MIN(sp.final_cost_ars) * p.markup_regular
        ELSE NULL
      END AS regular_price,
      -- Is offer active?
      CASE
        WHEN (p.markup_offer IS NOT NULL OR p.own_price_offer IS NOT NULL)
          AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
          AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
          THEN 1 ELSE 0
      END AS is_on_offer
    FROM products p
    LEFT JOIN product_supplier_links psl ON psl.product_id = p.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
    LEFT JOIN supplier_prices sp ON sp.link_id = psl.id
    WHERE p.id = ?
    GROUP BY p.id
  `;

  const row = db.$client.prepare(query).get(productId) as {
    product_id: number;
    product_name: string;
    product_sku: string | null;
    markup_regular: number;
    own_price_regular: number | null;
    has_supplier_stock: number;
    local_stock: number;
    best_cost_ars: number | null;
    max_link_stock: number | null;
    client_price: number | null;
    regular_price: number | null;
    is_on_offer: number;
  } | undefined;

  if (!row || row.client_price === null) return null;

  return {
    productId: row.product_id,
    productName: row.product_name,
    productSku: row.product_sku,
    clientPrice: Math.round(row.client_price * 100) / 100,
    regularPrice: row.regular_price !== null ? Math.round(row.regular_price * 100) / 100 : null,
    isOnOffer: row.is_on_offer === 1,
    hasStock: Boolean(row.has_supplier_stock) || row.local_stock > 0 || (row.max_link_stock ?? 0) > 0,
  };
}

// ─── Core refresh logic ───────────────────────────────────────────────────────

/**
 * Refresh a combo template: resolve all slots, update cached prices,
 * and optionally update the linked product's own_price_regular.
 *
 * This is the single source of truth for combo refresh — called from both
 * /api/combos/[id]/refresh and /api/combos/refresh-all.
 */
export function refreshCombo(templateId: number): ComboResolutionResult {
  const template = db
    .select()
    .from(comboTemplates)
    .where(eq(comboTemplates.id, templateId))
    .get();

  if (!template) {
    throw new Error(`Combo template ${templateId} not found`);
  }

  const slots = db
    .select()
    .from(comboSlots)
    .where(eq(comboSlots.templateId, templateId))
    .orderBy(asc(comboSlots.sortOrder))
    .all();

  const resolvedAt = new Date().toISOString();
  const slotResults: SlotResolutionResult[] = [];

  for (const slot of slots) {
    let result: SlotResolutionResult;

    try {
      if (slot.slotType === "fixed") {
        if (!slot.fixedProductId) {
          result = makeFailedSlot(slot, "Slot fijo sin producto configurado");
        } else {
          const resolved = resolveFixedSlot(slot.fixedProductId);
          if (!resolved) {
            result = makeFailedSlot(
              slot,
              `Producto ID ${slot.fixedProductId} no encontrado o sin precio`
            );
          } else {
            result = {
              slotId: slot.id,
              slotName: slot.slotName,
              slotType: "fixed",
              quantity: slot.quantity,
              sortOrder: slot.sortOrder,
              resolvedProductId: resolved.productId,
              resolvedProductName: resolved.productName,
              resolvedProductSku: resolved.productSku,
              resolvedPrice: resolved.clientPrice,
              regularPrice: resolved.regularPrice,
              isOnOffer: resolved.isOnOffer,
              hasStock: resolved.hasStock,
              error: resolved.hasStock ? null : "Producto sin stock",
            };
          }
        }
      } else if (slot.slotType === "combo") {
        // Combo slot: references another combo template by fixedComboId
        if (!slot.fixedComboId) {
          result = makeFailedSlot(slot, "Slot combo sin referencia configurada");
        } else {
          const refCombo = db
            .select()
            .from(comboTemplates)
            .where(eq(comboTemplates.id, slot.fixedComboId))
            .get();

          if (!refCombo) {
            result = makeFailedSlot(slot, `Combo ID ${slot.fixedComboId} no encontrado`);
          } else {
            // If the referenced combo hasn't been refreshed, refresh it now
            if (refCombo.lastTotalPrice === null || refCombo.lastRefreshedAt === null) {
              try {
                const refreshed = refreshCombo(slot.fixedComboId);
                result = {
                  slotId: slot.id,
                  slotName: slot.slotName,
                  slotType: "combo",
                  quantity: slot.quantity,
                  sortOrder: slot.sortOrder,
                  resolvedProductId: null,
                  resolvedProductName: refCombo.name,
                  resolvedProductSku: refCombo.sku,
                  resolvedPrice: refreshed.totalPrice,
                  regularPrice: refreshed.totalPrice,
                  isOnOffer: false,
                  hasStock: refreshed.hasStock,
                  error: refreshed.totalPrice === null ? `Combo ${refCombo.sku} sin precio` : null,
                };
              } catch (err) {
                result = makeFailedSlot(slot, `Error al resolver combo ${refCombo.sku}: ${err instanceof Error ? err.message : String(err)}`);
              }
            } else {
              result = {
                slotId: slot.id,
                slotName: slot.slotName,
                slotType: "combo",
                quantity: slot.quantity,
                sortOrder: slot.sortOrder,
                resolvedProductId: null,
                resolvedProductName: refCombo.name,
                resolvedProductSku: refCombo.sku,
                resolvedPrice: refCombo.lastTotalPrice,
                regularPrice: refCombo.lastTotalPrice,
                isOnOffer: false,
                hasStock: refCombo.lastHasStock ?? false,
                error: null,
              };
            }
          }
        }
      } else {
        // auto slot
        const category = slot.filterCategory;
        const mustKeywords: string[] = slot.filterMustKeywords
          ? JSON.parse(slot.filterMustKeywords)
          : [];
        const keywords: string[] = slot.filterKeywords
          ? JSON.parse(slot.filterKeywords)
          : [];
        const filterAttributes: Record<string, string> | undefined = slot.filterAttributes
          ? JSON.parse(slot.filterAttributes)
          : undefined;

        if (!category) {
          result = makeFailedSlot(slot, "Slot auto sin categoría configurada");
        } else {
          const resolved = resolveAutoSlot(category, keywords, filterAttributes, mustKeywords);
          if (!resolved) {
            const kwDesc =
              keywords.length > 0 ? ` [${keywords.join(", ")}]` : "";
            result = makeFailedSlot(
              slot,
              `Sin stock en categoría "${category}"${kwDesc}`
            );
          } else {
            result = {
              slotId: slot.id,
              slotName: slot.slotName,
              slotType: "auto",
              quantity: slot.quantity,
              sortOrder: slot.sortOrder,
              resolvedProductId: resolved.productId,
              resolvedProductName: resolved.productName,
              resolvedProductSku: resolved.productSku,
              resolvedPrice: resolved.clientPrice,
              regularPrice: resolved.regularPrice,
              isOnOffer: resolved.isOnOffer,
              hasStock: resolved.hasStock,
              error: null,
            };
          }
        }
      }
    } catch (err) {
      result = makeFailedSlot(
        slot,
        err instanceof Error ? err.message : "Error desconocido"
      );
    }

    // Persist resolution to DB
    db.update(comboSlots)
      .set({
        resolvedProductId: result.resolvedProductId,
        resolvedPrice: result.resolvedPrice,
        resolvedAt,
      })
      .where(eq(comboSlots.id, slot.id))
      .run();

    slotResults.push(result);
  }

  // Calculate totals
  const allResolved = slotResults.every((s) => s.resolvedPrice !== null);
  const allInStock = slotResults.every((s) => s.hasStock);

  // Offer price: sum of each slot's resolved (offer) price
  const totalOfferPrice = allResolved
    ? Math.round(
        slotResults.reduce((sum, s) => sum + s.resolvedPrice! * s.quantity, 0) * 100
      ) / 100
    : null;

  // Regular price: sum of each slot's regular price (without offer), fallback to resolved price
  const totalRegularPrice = allResolved
    ? Math.round(
        slotResults.reduce(
          (sum, s) => sum + (s.regularPrice ?? s.resolvedPrice!) * s.quantity,
          0
        ) * 100
      ) / 100
    : null;

  // The combo is on offer if at least one component is on offer AND offer < regular
  const isComboOnOffer =
    slotResults.some((s) => s.isOnOffer) &&
    totalOfferPrice !== null &&
    totalRegularPrice !== null &&
    totalOfferPrice < totalRegularPrice;

  // totalPrice is the effective selling price (offer if on offer, regular otherwise)
  const totalPrice = totalOfferPrice;

  // Update combo template cache
  db.update(comboTemplates)
    .set({
      lastTotalPrice: totalPrice,
      lastHasStock: allInStock,
      lastRefreshedAt: resolvedAt,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(eq(comboTemplates.id, templateId))
    .run();

  // Sync price and stock to linked product
  if (template.productId) {
    const linked = db
      .select({ id: products.id, ownPriceRegular: products.ownPriceRegular, ownPriceOffer: products.ownPriceOffer, hasSupplierStock: products.hasSupplierStock })
      .from(products)
      .where(eq(products.id, template.productId))
      .get();

    if (linked) {
      // Determine new prices based on offer state
      const newOwnPriceRegular = isComboOnOffer ? totalRegularPrice : totalOfferPrice;
      const newOwnPriceOffer = isComboOnOffer ? totalOfferPrice : null;

      const priceChanged =
        linked.ownPriceRegular !== newOwnPriceRegular ||
        linked.ownPriceOffer !== newOwnPriceOffer;
      const stockChanged = Boolean(linked.hasSupplierStock) !== allInStock;

      if (priceChanged || stockChanged) {
        db.update(products)
          .set({
            ownPriceRegular: newOwnPriceRegular,
            ownPriceOffer: newOwnPriceOffer,
            hasSupplierStock: allInStock,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(products.id, template.productId))
          .run();

        // Keep supplier link qty in sync so the product detail view reflects real stock
        db.update(productSupplierLinks)
          .set({ supplierStockQty: allInStock ? 1 : 0 })
          .where(eq(productSupplierLinks.productId, template.productId))
          .run();

        // Only record price history when price actually changed
        if (priceChanged && newOwnPriceRegular !== null) {
          db.insert(productPriceHistory)
            .values({
              productId: template.productId,
              priceRegular: newOwnPriceRegular,
              priceOffer: newOwnPriceOffer,
            })
            .run();
        }
      }
    }
  }

  return {
    templateId,
    templateName: template.name,
    templateSku: template.sku,
    slots: slotResults,
    totalPrice,
    hasStock: allInStock,
    resolvedAt,
    errors: slotResults.filter((s) => s.error).map((s) => `${s.slotName}: ${s.error}`),
  };
}

/**
 * Refresh all active combo templates.
 * Runs synchronously (better-sqlite3). Safe to call from supplier import routes.
 * Errors per-combo are caught and don't stop the rest.
 */
export function refreshAllCombos(): void {
  const active = db
    .select({ id: comboTemplates.id })
    .from(comboTemplates)
    .where(eq(comboTemplates.isActive, true))
    .all();

  for (const t of active) {
    try {
      refreshCombo(t.id);
    } catch {
      // ignore per-combo failures — don't block the import
    }
  }
}

/**
 * Refresh all buscador items: resolve cheapest matching product for each.
 * Safe to call from supplier import routes — errors per-item are swallowed.
 */
export function refreshAllBuscador(): void {
  const items = db.select().from(buscadorItems).all();
  const resolvedAt = new Date().toISOString();

  for (const item of items) {
    try {
      const mustKeywords: string[] = item.filterMustKeywords ? JSON.parse(item.filterMustKeywords) : [];
      const keywords: string[] = item.filterKeywords ? JSON.parse(item.filterKeywords) : [];
      const filterAttributes: Record<string, string> | undefined = item.filterAttributes
        ? JSON.parse(item.filterAttributes)
        : undefined;
      const resolved = resolveAutoSlot(
        item.filterCategory,
        keywords,
        filterAttributes,
        mustKeywords,
        item.filterMinPrice ?? null,
        item.filterMaxPrice ?? null
      );
      db.update(buscadorItems)
        .set({
          resolvedProductId: resolved?.productId ?? null,
          resolvedProductName: resolved?.productName ?? null,
          resolvedPrice: resolved?.clientPrice ?? null,
          resolvedHasStock: resolved ? resolved.hasStock : null,
          resolvedAt,
        })
        .where(eq(buscadorItems.id, item.id))
        .run();
    } catch {
      // ignore per-item errors
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFailedSlot(
  slot: { id: number; slotName: string; slotType: string; quantity: number; sortOrder: number },
  error: string
): SlotResolutionResult {
  return {
    slotId: slot.id,
    slotName: slot.slotName,
    slotType: slot.slotType as "auto" | "fixed" | "combo",
    quantity: slot.quantity,
    sortOrder: slot.sortOrder,
    resolvedProductId: null,
    resolvedProductName: null,
    resolvedProductSku: null,
    resolvedPrice: null,
    regularPrice: null,
    isOnOffer: false,
    hasStock: false,
    error,
  };
}
