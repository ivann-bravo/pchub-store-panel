import { sqliteTable, text, integer, real, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  currency: text("currency", { enum: ["ARS", "USD"] }).notNull().default("ARS"),
  taxRate: real("tax_rate").notNull().default(0),
  shippingSurcharge: real("shipping_surcharge").notNull().default(0),
  shippingPercent: real("shipping_percent").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  columnMapping: text("column_mapping"), // JSON string for saved import mappings
  connectorType: text("connector_type").notNull().default("manual"), // "manual" | "api"
  apiConfig: text("api_config"), // JSON: { baseUrl, username, password, connectorId }
  autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(false),
  stockConfig: text("stock_config"), // JSON: { lowStockQty, defaultStockQty }
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const products = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  woocommerceId: integer("woocommerce_id"),
  name: text("name").notNull(),
  sku: text("sku"),
  eanUpc: text("ean_upc"),
  category: text("category"),
  brand: text("brand"),
  warranty: text("warranty"),
  ivaRate: real("iva_rate").notNull().default(0.21),
  internalTaxRate: real("internal_tax_rate").notNull().default(0),
  markupRegular: real("markup_regular").notNull().default(1.0),
  markupOffer: real("markup_offer"),
  offerStart: text("offer_start"),
  offerEnd: text("offer_end"),
  ownPriceRegular: real("own_price_regular"),
  ownPriceOffer: real("own_price_offer"),
  ownCostUsd: real("own_cost_usd"),
  localStock: integer("local_stock").notNull().default(0),
  hasSupplierStock: integer("has_supplier_stock", { mode: "boolean" }).notNull().default(false),
  weightKg: real("weight_kg"),
  lengthCm: real("length_cm"),
  widthCm: real("width_cm"),
  heightCm: real("height_cm"),
  imageUrl: text("image_url"),
  galleryImages: text("gallery_images"),        // JSON: string[] of additional image URLs
  slug: text("slug"),
  storeUrl: text("store_url"),
  productTags: text("product_tags"),
  wooCategoryIds: text("woo_category_ids"),     // JSON: number[] of WooCommerce category IDs
  attributes: text("attributes"), // JSON: {"socket":"1700","memoryType":"DDR4","gpuIntegrado":false}
  shortDescription: text("short_description"), // HTML, up to 5 key specs as <ul>
  description: text("description"),            // Full HTML description for WooCommerce
  wooManualPrivate: integer("woo_manual_private", { mode: "boolean" }).notNull().default(false),
  wooSyncPending: integer("woo_sync_pending", { mode: "boolean" }).notNull().default(false),
  wooLastSyncedAt: text("woo_last_synced_at"),
  wooSyncedRegularPrice: real("woo_synced_regular_price"),
  wooSyncedOfferPrice: real("woo_synced_offer_price"),   // offer price pushed in last successful sync
  wooSyncedStockQty: integer("woo_synced_stock_qty"),    // total stock qty pushed in last successful sync
  imageAuditStatus: text("image_audit_status"),          // "ok"|"needs_conversion"|"bad_quality"|"no_image"
  imageAuditData: text("image_audit_data"),              // JSON: { width, height, format, hasWhiteBg, checkedAt }
  wooMainImageAttachmentId: integer("woo_main_image_attachment_id"), // WC attachment ID for cleanup on replace
  wooGalleryAttachmentIds: text("woo_gallery_attachment_ids"),       // JSON: number[] — WC gallery attachment IDs
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const productSupplierLinks = sqliteTable(
  "product_supplier_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    supplierCode: text("supplier_code").notNull(),
    supplierStockQty: integer("supplier_stock_qty").notNull().default(0),
    stockLocked: integer("stock_locked", { mode: "boolean" }).notNull().default(false),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    uniqueProductSupplier: uniqueIndex("unique_product_supplier").on(table.productId, table.supplierId),
  })
);

export const supplierPrices = sqliteTable("supplier_prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  linkId: integer("link_id").notNull().references(() => productSupplierLinks.id, { onDelete: "cascade" }),
  rawPrice: real("raw_price").notNull(),
  currency: text("currency", { enum: ["ARS", "USD"] }).notNull(),
  exchangeRate: real("exchange_rate"),
  finalCostArs: real("final_cost_ars").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const supplierCatalogs = sqliteTable("supplier_catalogs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  rowCount: integer("row_count").notNull().default(0),
  linkedCount: integer("linked_count").notNull().default(0),
  importedAt: text("imported_at").notNull().default(sql`(datetime('now'))`),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] }).notNull().default("pending"),
});

export const supplierCatalogItems = sqliteTable("supplier_catalog_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  catalogId: integer("catalog_id").notNull().references(() => supplierCatalogs.id, { onDelete: "cascade" }),
  supplierCode: text("supplier_code"),
  description: text("description"),
  price: real("price"),
  currency: text("currency"),
  stockAvailable: integer("stock_available", { mode: "boolean" }),
  rawData: text("raw_data"), // JSON
  linkedProductId: integer("linked_product_id").references(() => products.id),
  matchConfidence: real("match_confidence"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const exchangeRates = sqliteTable("exchange_rates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().default("oficial"),
  buyRate: real("buy_rate").notNull(),
  sellRate: real("sell_rate").notNull(),
  fetchedAt: text("fetched_at").notNull().default(sql`(datetime('now'))`),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  value: text("value").notNull(), // JSON
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const priceHistory = sqliteTable(
  "price_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    linkId: integer("link_id").notNull().references(() => productSupplierLinks.id, { onDelete: "cascade" }),
    rawPrice: real("raw_price").notNull(),
    currency: text("currency").notNull(),
    exchangeRate: real("exchange_rate"),
    finalCostArs: real("final_cost_ars").notNull(),
    recordedAt: text("recorded_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    linkRecordedIdx: index("idx_price_history_link_recorded").on(table.linkId, table.recordedAt),
  })
);

export const productPriceHistory = sqliteTable(
  "product_price_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    priceRegular: real("price_regular"),
    priceOffer: real("price_offer"),
    recordedAt: text("recorded_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    productRecordedIdx: index("idx_product_price_history_product_recorded").on(table.productId, table.recordedAt),
  })
);

export const dismissedMatches = sqliteTable(
  "dismissed_matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    supplierId: integer("supplier_id").notNull().references(() => suppliers.id, { onDelete: "cascade" }),
    supplierCode: text("supplier_code").notNull(),
    dismissType: text("dismiss_type", { enum: ["match", "create"] }).notNull(),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    uniqueDismiss: uniqueIndex("unique_dismissed_match").on(table.supplierId, table.supplierCode, table.dismissType),
  })
);

// ─── Combo Builder ────────────────────────────────────────────────────────────

export const comboTemplates = sqliteTable("combo_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  sku: text("sku").notNull().unique(), // PCTRY####
  productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastTotalPrice: real("last_total_price"),
  lastHasStock: integer("last_has_stock", { mode: "boolean" }),
  lastRefreshedAt: text("last_refreshed_at"),
  notes: text("notes"),
  description: text("description"), // AI-generated product description for WooCommerce
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const buscadorItems = sqliteTable("buscador_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  groupName: text("group_name").notNull(),
  label: text("label").notNull(),
  filterCategory: text("filter_category").notNull(),
  filterMustKeywords: text("filter_must_keywords"), // JSON: string[] — line 2 OR group (ANDed with line 1)
  filterKeywords: text("filter_keywords"),           // JSON: string[] — line 1 OR group
  filterAttributes: text("filter_attributes"), // JSON: {"memoryType":"DDR4","socket":"1700"}
  filterMinPrice: real("filter_min_price"),    // Optional: min client price (ARS)
  filterMaxPrice: real("filter_max_price"),    // Optional: max client price (ARS)
  sortOrder: integer("sort_order").notNull().default(0),
  // Cached resolution (updated on each refresh)
  resolvedProductId: integer("resolved_product_id").references(() => products.id, { onDelete: "set null" }),
  resolvedProductName: text("resolved_product_name"),
  resolvedPrice: real("resolved_price"),
  resolvedHasStock: integer("resolved_has_stock", { mode: "boolean" }),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const wooCategories = sqliteTable("woo_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wooId: integer("woo_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  parentId: integer("parent_id").notNull().default(0), // 0 = root category
  count: integer("count").notNull().default(0),
  syncedAt: text("synced_at").notNull().default(sql`(datetime('now'))`),
});

export const wooSyncBlocked = sqliteTable(
  "woo_sync_blocked",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    wooId: integer("woo_id").notNull(),
    productName: text("product_name").notNull(),
    reason: text("reason").notNull(),
    newPrice: real("new_price"),
    oldPrice: real("old_price"),
    payload: text("payload").notNull(),  // JSON: full WC payload that was blocked
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
    reviewedAt: text("reviewed_at"),
    reviewedBy: text("reviewed_by"),     // email of reviewer
  },
  (table) => ({
    statusIdx: index("idx_woo_sync_blocked_status").on(table.status),
    productIdx: index("idx_woo_sync_blocked_product").on(table.productId),
  })
);

// ─── Purchase Orders ──────────────────────────────────────────────────────────

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  supplierOrderNumber: text("supplier_order_number"),
  totalPaid: real("total_paid"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  closedAt: text("closed_at"),
});

export const purchaseOrderItems = sqliteTable("purchase_order_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchaseOrderId: integer("purchase_order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => products.id),
  supplierId: integer("supplier_id").notNull().references(() => suppliers.id),
  supplierCode: text("supplier_code").notNull().default(""),
  quantity: integer("quantity").notNull().default(1),
  unitCostArs: real("unit_cost_ars"),
  clientPaidAmount: real("client_paid_amount"),
  wcOrderId: integer("wc_order_id"),
  wcOrderRef: text("wc_order_ref"),
  goesToStock: integer("goes_to_stock", { mode: "boolean" }).notNull().default(false),
  stockEntryPrice: real("stock_entry_price"),
  notes: text("notes"),
  stockAlertStatus: text("stock_alert_status", { enum: ["out_of_stock", "alt_available", "back_in_stock"] }),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Historical Margins ───────────────────────────────────────────────────────
// Stores manually-entered margin data for periods before the purchase order system
// was in use. Stats endpoint merges this with real purchase order data automatically.
// week: 1-4 for weekly entries, NULL for monthly-only entries (no weekly breakdown).

export const historicalMargins = sqliteTable("historical_margins", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  year: integer("year").notNull(),
  month: integer("month").notNull(),             // 1-12
  week: integer("week"),                         // 1-4 or NULL (full month)
  cashRevenue: real("cash_revenue").notNull().default(0),
  stockValue: real("stock_value").notNull().default(0),
  totalCost: real("total_cost").notNull().default(0),
  cashMargin: real("cash_margin").notNull().default(0),
  totalMargin: real("total_margin").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const wooSyncLog = sqliteTable("woo_sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  panelId: integer("panel_id"),                          // products.id (nullable)
  wooId: integer("woo_id").notNull(),                    // WooCommerce product ID
  productName: text("product_name").notNull(),
  source: text("source").notNull().default("pull"),      // 'pull' | 'push'
  regularPrice: real("regular_price"),                   // what was synced
  offerPrice: real("offer_price"),
  stockQty: integer("stock_qty"),
  syncedAt: text("synced_at").notNull().default(sql`(datetime('now'))`),
});

// ─── Quote / Presupuesto ───────────────────────────────────────────────────────

export const quoteSessions = sqliteTable("quote_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientName: text("client_name").notNull(),
  clientPhone: text("client_phone"),
  clientEmail: text("client_email"),
  status: text("status", {
    enum: ["open", "following_up", "closed_wc", "closed_wpp", "closed_other", "lost"],
  }).notNull().default("open"),
  closedQuoteId: integer("closed_quote_id"),  // FK → quotes.id, set on close
  closedNotes: text("closed_notes"),
  wcOrderId: text("wc_order_id"),
  exchangeRateAtCreation: real("exchange_rate_at_creation"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const quotes = sqliteTable("quotes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: integer("session_id").notNull().references(() => quoteSessions.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("Opción 1"),
  sortOrder: integer("sort_order").notNull().default(0),
  resolvedTotal: real("resolved_total"),
  resolvedAt: text("resolved_at"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const quoteItems = sqliteTable("quote_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quoteId: integer("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  itemName: text("item_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  isOptional: integer("is_optional", { mode: "boolean" }).notNull().default(false),
  itemType: text("item_type", { enum: ["auto", "fixed", "text"] }).notNull().default("auto"),
  // Auto slot
  filterCategory: text("filter_category"),
  filterKeywords: text("filter_keywords"),     // JSON: string[]
  filterMustKeywords: text("filter_must_keywords"), // JSON: string[]
  filterAttributes: text("filter_attributes"), // JSON: {"socket":"AM5","memoryType":"DDR5"}
  filterMinPrice: real("filter_min_price"),
  filterMaxPrice: real("filter_max_price"),
  // Fixed slot
  fixedProductId: integer("fixed_product_id").references(() => products.id, { onDelete: "set null" }),
  // Text slot
  textPrice: real("text_price"),
  textSku: text("text_sku"),
  // Resolution cache
  resolvedProductId: integer("resolved_product_id").references(() => products.id, { onDelete: "set null" }),
  resolvedProductName: text("resolved_product_name"),
  resolvedProductSku: text("resolved_product_sku"),
  resolvedImageUrl: text("resolved_image_url"),
  resolvedPrice: real("resolved_price"),
  resolvedHasStock: integer("resolved_has_stock", { mode: "boolean" }),
  resolvedAt: text("resolved_at"),
  // Manual price override
  manualPrice: real("manual_price"),
  manualPriceNote: text("manual_price_note"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const wooAttributeMappings = sqliteTable("woo_attribute_mappings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  panelKey: text("panel_key").notNull(),         // e.g. "socket", "memoryType"
  wooAttributeId: integer("woo_attribute_id").notNull(),
  wooAttributeName: text("woo_attribute_name").notNull(),
  wooAttributeSlug: text("woo_attribute_slug").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["SUPER_ADMIN", "VIEWER"] }).notNull().default("VIEWER"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  lastLoginAt: text("last_login_at"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const comboSlots = sqliteTable(
  "combo_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    templateId: integer("template_id")
      .notNull()
      .references(() => comboTemplates.id, { onDelete: "cascade" }),
    slotName: text("slot_name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    slotType: text("slot_type", { enum: ["auto", "fixed", "combo"] }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    // Fixed slot (product)
    fixedProductId: integer("fixed_product_id").references(() => products.id, { onDelete: "set null" }),
    // Fixed slot (nested combo)
    fixedComboId: integer("fixed_combo_id").references(() => comboTemplates.id, { onDelete: "set null" }),
    // Auto slot filters
    filterCategory: text("filter_category"),
    filterMustKeywords: text("filter_must_keywords"), // JSON: string[] — ALL must match (AND)
    filterKeywords: text("filter_keywords"),           // JSON: string[] — ANY can match (OR)
    filterAttributes: text("filter_attributes"), // JSON: {"memoryType":"DDR4"}
    // Cached resolution (updated on each refresh)
    resolvedProductId: integer("resolved_product_id").references(() => products.id, { onDelete: "set null" }),
    resolvedPrice: real("resolved_price"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    templateIdx: index("idx_combo_slots_template").on(table.templateId),
  })
);
