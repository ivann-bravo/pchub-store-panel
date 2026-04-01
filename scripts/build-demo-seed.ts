#!/usr/bin/env npx tsx
/**
 * scripts/build-demo-seed.ts
 *
 * Builds data/demo-seed.db with fictional demo data for the PCHub Store Panel demo.
 * Run with: npx tsx scripts/build-demo-seed.ts
 *
 * This DB is committed to the repo and copied to /tmp at runtime on Vercel (DEMO_MODE=true).
 */

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";

const DB_PATH = path.join(process.cwd(), "data", "demo-seed.db");

// ─── Setup ────────────────────────────────────────────────────────────────────

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// ─── DDL — all tables the app needs ──────────────────────────────────────────

db.exec(`
  CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ARS',
    tax_rate REAL NOT NULL DEFAULT 0,
    shipping_surcharge REAL NOT NULL DEFAULT 0,
    shipping_percent REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    column_mapping TEXT,
    connector_type TEXT NOT NULL DEFAULT 'manual',
    api_config TEXT,
    auto_sync INTEGER NOT NULL DEFAULT 0,
    stock_config TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    woocommerce_id INTEGER,
    name TEXT NOT NULL,
    sku TEXT,
    ean_upc TEXT,
    category TEXT,
    brand TEXT,
    warranty TEXT,
    iva_rate REAL NOT NULL DEFAULT 0.21,
    internal_tax_rate REAL NOT NULL DEFAULT 0,
    markup_regular REAL NOT NULL DEFAULT 1.0,
    markup_offer REAL,
    offer_start TEXT,
    offer_end TEXT,
    own_price_regular REAL,
    own_price_offer REAL,
    own_cost_usd REAL,
    local_stock INTEGER NOT NULL DEFAULT 0,
    has_supplier_stock INTEGER NOT NULL DEFAULT 0,
    weight_kg REAL,
    length_cm REAL,
    width_cm REAL,
    height_cm REAL,
    image_url TEXT,
    gallery_images TEXT,
    slug TEXT,
    store_url TEXT,
    product_tags TEXT,
    woo_category_ids TEXT,
    attributes TEXT,
    short_description TEXT,
    description TEXT,
    best_cost_ars REAL,
    best_supplier_code TEXT,
    best_supplier_name TEXT,
    best_supplier_stock_qty INTEGER NOT NULL DEFAULT 0,
    woo_manual_private INTEGER NOT NULL DEFAULT 0,
    woo_sync_pending INTEGER NOT NULL DEFAULT 0,
    woo_last_synced_at TEXT,
    woo_synced_regular_price REAL,
    woo_synced_offer_price REAL,
    woo_synced_stock_qty INTEGER,
    image_audit_status TEXT,
    image_audit_data TEXT,
    woo_main_image_attachment_id INTEGER,
    woo_gallery_attachment_ids TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE product_supplier_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_code TEXT NOT NULL,
    supplier_stock_qty INTEGER NOT NULL DEFAULT 0,
    stock_locked INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(product_id, supplier_id)
  );

  CREATE TABLE supplier_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES product_supplier_links(id) ON DELETE CASCADE,
    raw_price REAL NOT NULL,
    currency TEXT NOT NULL,
    exchange_rate REAL,
    final_cost_ars REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES product_supplier_links(id) ON DELETE CASCADE,
    raw_price REAL NOT NULL,
    currency TEXT NOT NULL,
    exchange_rate REAL,
    final_cost_ars REAL NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE product_price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_regular REAL,
    price_offer REAL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE supplier_catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    linked_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE supplier_catalog_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catalog_id INTEGER NOT NULL REFERENCES supplier_catalogs(id) ON DELETE CASCADE,
    supplier_code TEXT,
    description TEXT,
    price REAL,
    currency TEXT,
    stock_available INTEGER,
    raw_data TEXT,
    linked_product_id INTEGER REFERENCES products(id),
    match_confidence REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'oficial',
    buy_rate REAL NOT NULL,
    sell_rate REAL NOT NULL,
    fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(role IN ('SUPER_ADMIN', 'VIEWER')),
    is_active INTEGER NOT NULL DEFAULT 1,
    totp_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE dismissed_matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    supplier_code TEXT NOT NULL,
    dismiss_type TEXT NOT NULL CHECK(dismiss_type IN ('match', 'create')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE combo_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_total_price REAL,
    last_has_stock INTEGER,
    last_refreshed_at TEXT,
    description TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE combo_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL REFERENCES combo_templates(id) ON DELETE CASCADE,
    slot_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    slot_type TEXT NOT NULL CHECK(slot_type IN ('auto', 'fixed', 'combo')),
    quantity INTEGER NOT NULL DEFAULT 1,
    fixed_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    fixed_combo_id INTEGER REFERENCES combo_templates(id) ON DELETE SET NULL,
    filter_category TEXT,
    filter_keywords TEXT,
    filter_must_keywords TEXT,
    filter_attributes TEXT,
    resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    resolved_price REAL,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE buscador_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_name TEXT NOT NULL,
    label TEXT NOT NULL,
    filter_category TEXT NOT NULL,
    filter_keywords TEXT,
    filter_must_keywords TEXT,
    filter_attributes TEXT,
    filter_min_price REAL,
    filter_max_price REAL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    resolved_product_name TEXT,
    resolved_price REAL,
    resolved_has_stock INTEGER,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE woo_export_snapshots (
    product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
    woocommerce_id INTEGER NOT NULL,
    stock_qty INTEGER NOT NULL,
    stock_status TEXT NOT NULL,
    post_status TEXT NOT NULL,
    regular_price INTEGER,
    sale_price INTEGER,
    offer_start TEXT,
    offer_end TEXT,
    exported_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE woo_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    woo_id INTEGER NOT NULL UNIQUE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    parent_id INTEGER NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE woo_attribute_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_key TEXT NOT NULL UNIQUE,
    woo_attribute_id INTEGER NOT NULL,
    woo_attribute_name TEXT NOT NULL,
    woo_attribute_slug TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE woo_sync_blocked (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    woo_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    reason TEXT NOT NULL,
    new_price REAL,
    old_price REAL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewed_by TEXT
  );

  CREATE TABLE woo_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    panel_id INTEGER,
    woo_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'pull',
    regular_price REAL,
    offer_price REAL,
    stock_qty INTEGER,
    prev_regular_price REAL,
    prev_offer_price REAL,
    prev_stock_qty INTEGER,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    supplier_order_number TEXT,
    total_paid REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );

  CREATE TABLE purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    supplier_code TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_cost_ars REAL,
    client_paid_amount REAL,
    wc_order_id INTEGER,
    wc_order_ref TEXT,
    goes_to_stock INTEGER NOT NULL DEFAULT 0,
    stock_entry_price REAL,
    stock_alert_status TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE historical_margins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    week INTEGER,
    cash_revenue REAL NOT NULL DEFAULT 0,
    stock_value REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    cash_margin REAL NOT NULL DEFAULT 0,
    total_margin REAL NOT NULL DEFAULT 0,
    order_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(year, month, week)
  );

  CREATE TABLE quote_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    client_phone TEXT,
    client_email TEXT,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK(status IN ('open','following_up','closed_wc','closed_wpp','closed_other','lost')),
    closed_quote_id INTEGER,
    closed_notes TEXT,
    wc_order_id TEXT,
    exchange_rate_at_creation REAL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES quote_sessions(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Opción 1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    resolved_total REAL,
    resolved_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quote_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    is_optional INTEGER NOT NULL DEFAULT 0,
    item_type TEXT NOT NULL DEFAULT 'auto' CHECK(item_type IN ('auto','fixed','text')),
    filter_category TEXT,
    filter_keywords TEXT,
    filter_must_keywords TEXT,
    filter_attributes TEXT,
    filter_min_price REAL,
    filter_max_price REAL,
    fixed_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    text_price REAL,
    text_sku TEXT,
    resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    resolved_product_name TEXT,
    resolved_product_sku TEXT,
    resolved_image_url TEXT,
    resolved_price REAL,
    resolved_has_stock INTEGER,
    resolved_at TEXT,
    manual_price REAL,
    manual_price_note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Indexes ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE INDEX idx_supplier_prices_link_id ON supplier_prices(link_id);
  CREATE INDEX idx_supplier_prices_link_cost ON supplier_prices(link_id, final_cost_ars);
  CREATE INDEX idx_psl_product_id ON product_supplier_links(product_id);
  CREATE INDEX idx_psl_supplier_id ON product_supplier_links(supplier_id);
  CREATE INDEX idx_psl_active_stock ON product_supplier_links(is_active, supplier_stock_qty);
  CREATE INDEX idx_products_category ON products(category);
  CREATE INDEX idx_products_brand ON products(brand);
  CREATE INDEX idx_products_sku ON products(sku);
  CREATE INDEX idx_products_name ON products(name);
  CREATE INDEX idx_products_category_brand ON products(category, brand);
  CREATE INDEX idx_products_best_cost ON products(best_cost_ars);
  CREATE INDEX idx_price_history_link_recorded ON price_history(link_id, recorded_at);
  CREATE INDEX idx_combo_slots_template ON combo_slots(template_id);
  CREATE INDEX idx_purchase_orders_supplier ON purchase_orders(supplier_id);
  CREATE INDEX idx_purchase_orders_status ON purchase_orders(status);
  CREATE INDEX idx_poi_order ON purchase_order_items(purchase_order_id);
  CREATE INDEX idx_poi_product ON purchase_order_items(product_id);
  CREATE INDEX idx_quote_sessions_status ON quote_sessions(status);
  CREATE INDEX idx_quote_sessions_updated ON quote_sessions(updated_at DESC);
  CREATE INDEX idx_quotes_session ON quotes(session_id);
  CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);
  CREATE INDEX idx_woo_sync_blocked_status ON woo_sync_blocked(status);
  CREATE INDEX idx_settings_key ON settings(key);
  CREATE INDEX idx_users_email ON users(email);
`);

console.log("✅ Tables and indexes created");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EX = 1250; // demo exchange rate ARS/USD

function calcFinalCostArs(rawPrice: number, currency: "ARS" | "USD", taxRate: number, shippingPercent: number): number {
  const base = currency === "USD" ? rawPrice * EX : rawPrice;
  return base * (1 + taxRate + shippingPercent);
}

function roundToNine(n: number): number {
  const base = Math.floor(n / 10) * 10;
  const candidate = base + 9;
  return candidate >= n ? candidate : candidate + 10;
}

// ─── Exchange Rate ────────────────────────────────────────────────────────────

db.prepare("INSERT INTO exchange_rates (source, buy_rate, sell_rate) VALUES (?, ?, ?)").run("oficial", 1200, 1250);

// ─── Suppliers ────────────────────────────────────────────────────────────────

interface SupplierDef {
  code: string;
  name: string;
  currency: "ARS" | "USD";
  taxRate: number;
  shippingPercent: number;
}

const SUPPLIERS: SupplierDef[] = [
  { code: "NORTE", name: "NorteDistrib", currency: "ARS", taxRate: 0.21, shippingPercent: 0.03 },
  { code: "TSTOCK", name: "TechStock", currency: "USD", taxRate: 0, shippingPercent: 0.05 },
  { code: "PCWHL", name: "PCWholesale", currency: "ARS", taxRate: 0.21, shippingPercent: 0.02 },
  { code: "GADHUB", name: "GadgetHub", currency: "ARS", taxRate: 0.105, shippingPercent: 0.03 },
  { code: "BYTE", name: "ByteMarket", currency: "USD", taxRate: 0, shippingPercent: 0.04 },
  { code: "CTEK", name: "CompTek", currency: "ARS", taxRate: 0.21, shippingPercent: 0.025 },
];

const insSupplier = db.prepare(`
  INSERT INTO suppliers (code, name, currency, tax_rate, shipping_percent)
  VALUES (?, ?, ?, ?, ?)
`);
const supplierIds: Record<string, number> = {};
for (const s of SUPPLIERS) {
  const r = insSupplier.run(s.code, s.name, s.currency, s.taxRate, s.shippingPercent);
  supplierIds[s.code] = Number(r.lastInsertRowid);
}
console.log(`✅ ${SUPPLIERS.length} suppliers inserted`);

// ─── Products ─────────────────────────────────────────────────────────────────

interface ProductDef {
  name: string;
  sku: string;
  category: string;
  brand: string;
  warranty: string;
  ivaRate: number;
  markupRegular: number;
  imageUrl?: string;
  attributes?: Record<string, string | number | boolean>;
  // [supplierCode, rawPrice, currency, stockQty]
  suppliers: [string, number, "ARS" | "USD", number][];
}

const PRODUCTS: ProductDef[] = [
  // ── CPUs ─────────────────────────────────────────────────────────────────────
  { name: "AMD Ryzen 5 5600X", sku: "PCHUB-CPU-001", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "AM4", nucleos: 6, hilos: 12, frecuencia: "3.7 GHz" },
    suppliers: [["NORTE", 145000, "ARS", 5], ["TSTOCK", 112, "USD", 3], ["PCWHL", 148000, "ARS", 2]] },
  { name: "AMD Ryzen 7 5700X", sku: "PCHUB-CPU-002", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "AM4", nucleos: 8, hilos: 16, frecuencia: "3.4 GHz" },
    suppliers: [["NORTE", 185000, "ARS", 4], ["TSTOCK", 144, "USD", 2]] },
  { name: "AMD Ryzen 5 7600", sku: "PCHUB-CPU-003", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "AM5", nucleos: 6, hilos: 12, frecuencia: "3.8 GHz" },
    suppliers: [["BYTE", 132, "USD", 6], ["GADHUB", 172000, "ARS", 3]] },
  { name: "AMD Ryzen 7 7700X", sku: "PCHUB-CPU-004", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "AM5", nucleos: 8, hilos: 16, frecuencia: "4.5 GHz" },
    suppliers: [["TSTOCK", 229, "USD", 3], ["BYTE", 235, "USD", 2]] },
  { name: "AMD Ryzen 9 7900X", sku: "PCHUB-CPU-005", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { socket: "AM5", nucleos: 12, hilos: 24, frecuencia: "4.7 GHz" },
    suppliers: [["TSTOCK", 289, "USD", 2], ["BYTE", 295, "USD", 1]] },
  { name: "Intel Core i5-12400", sku: "PCHUB-CPU-006", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "1700", nucleos: 6, hilos: 12, frecuencia: "2.5 GHz", memoryType: "DDR4" },
    suppliers: [["NORTE", 152000, "ARS", 7], ["PCWHL", 149000, "ARS", 5], ["CTEK", 155000, "ARS", 3]] },
  { name: "Intel Core i5-13400", sku: "PCHUB-CPU-007", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "1700", nucleos: 10, hilos: 16, frecuencia: "2.5 GHz", memoryType: "DDR4" },
    suppliers: [["NORTE", 192000, "ARS", 6], ["TSTOCK", 149, "USD", 2]] },
  { name: "Intel Core i7-13700", sku: "PCHUB-CPU-008", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { socket: "1700", nucleos: 16, hilos: 24, frecuencia: "2.1 GHz" },
    suppliers: [["TSTOCK", 275, "USD", 3], ["BYTE", 279, "USD", 1]] },
  { name: "Intel Core i9-13900K", sku: "PCHUB-CPU-009", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { socket: "1700", nucleos: 24, hilos: 32, frecuencia: "3.0 GHz" },
    suppliers: [["TSTOCK", 389, "USD", 1], ["BYTE", 395, "USD", 1]] },
  { name: "Intel Core i5-14400", sku: "PCHUB-CPU-010", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "1700", nucleos: 10, hilos: 16, frecuencia: "2.5 GHz" },
    suppliers: [["NORTE", 203000, "ARS", 4], ["CTEK", 209000, "ARS", 3]] },
  { name: "AMD Ryzen 5 3600", sku: "PCHUB-CPU-011", category: "Procesadores", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "AM4", nucleos: 6, hilos: 12, frecuencia: "3.6 GHz" },
    suppliers: [["NORTE", 92000, "ARS", 8], ["GADHUB", 89000, "ARS", 5]] },
  { name: "Intel Core i3-13100", sku: "PCHUB-CPU-012", category: "Procesadores", brand: "Intel", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "1700", nucleos: 4, hilos: 8, frecuencia: "3.4 GHz", memoryType: "DDR4" },
    suppliers: [["NORTE", 118000, "ARS", 6], ["PCWHL", 115000, "ARS", 4], ["CTEK", 121000, "ARS", 2]] },

  // ── GPUs ──────────────────────────────────────────────────────────────────────
  { name: "NVIDIA GeForce GTX 1650", sku: "PCHUB-GPU-001", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { vram: "4GB", memoriaType: "GDDR6", bus: "128-bit" },
    suppliers: [["NORTE", 132000, "ARS", 4], ["CTEK", 135000, "ARS", 2]] },
  { name: "NVIDIA GeForce GTX 1660 Super", sku: "PCHUB-GPU-002", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { vram: "6GB", memoriaType: "GDDR6", bus: "192-bit" },
    suppliers: [["TSTOCK", 148, "USD", 3], ["BYTE", 152, "USD", 2]] },
  { name: "NVIDIA GeForce RTX 3060", sku: "PCHUB-GPU-003", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { vram: "12GB", memoriaType: "GDDR6", bus: "192-bit" },
    suppliers: [["TSTOCK", 195, "USD", 5], ["BYTE", 199, "USD", 3], ["NORTE", 251000, "ARS", 2]] },
  { name: "NVIDIA GeForce RTX 3060 Ti", sku: "PCHUB-GPU-004", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { vram: "8GB", memoriaType: "GDDR6X", bus: "256-bit" },
    suppliers: [["TSTOCK", 239, "USD", 3], ["BYTE", 245, "USD", 2]] },
  { name: "NVIDIA GeForce RTX 3070", sku: "PCHUB-GPU-005", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { vram: "8GB", memoriaType: "GDDR6", bus: "256-bit" },
    suppliers: [["TSTOCK", 315, "USD", 2], ["BYTE", 319, "USD", 1]] },
  { name: "NVIDIA GeForce RTX 4060", sku: "PCHUB-GPU-006", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { vram: "8GB", memoriaType: "GDDR6", bus: "128-bit" },
    suppliers: [["TSTOCK", 235, "USD", 6], ["BYTE", 239, "USD", 4], ["NORTE", 305000, "ARS", 2]] },
  { name: "NVIDIA GeForce RTX 4060 Ti", sku: "PCHUB-GPU-007", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { vram: "16GB", memoriaType: "GDDR6", bus: "128-bit" },
    suppliers: [["TSTOCK", 295, "USD", 4], ["BYTE", 299, "USD", 2]] },
  { name: "NVIDIA GeForce RTX 4070", sku: "PCHUB-GPU-008", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { vram: "12GB", memoriaType: "GDDR6X", bus: "192-bit" },
    suppliers: [["TSTOCK", 389, "USD", 3], ["BYTE", 395, "USD", 1]] },
  { name: "NVIDIA GeForce RTX 4070 Super", sku: "PCHUB-GPU-009", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { vram: "12GB", memoriaType: "GDDR6X", bus: "192-bit" },
    suppliers: [["TSTOCK", 429, "USD", 2], ["BYTE", 435, "USD", 1]] },
  { name: "NVIDIA GeForce RTX 4080 Super", sku: "PCHUB-GPU-010", category: "Placas de Video", brand: "NVIDIA", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.25,
    attributes: { vram: "16GB", memoriaType: "GDDR6X", bus: "256-bit" },
    suppliers: [["TSTOCK", 689, "USD", 1], ["BYTE", 699, "USD", 1]] },
  { name: "AMD Radeon RX 6600", sku: "PCHUB-GPU-011", category: "Placas de Video", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { vram: "8GB", memoriaType: "GDDR6", bus: "128-bit" },
    suppliers: [["NORTE", 189000, "ARS", 3], ["GADHUB", 185000, "ARS", 4]] },
  { name: "AMD Radeon RX 6700 XT", sku: "PCHUB-GPU-012", category: "Placas de Video", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { vram: "12GB", memoriaType: "GDDR6", bus: "192-bit" },
    suppliers: [["TSTOCK", 235, "USD", 2], ["GADHUB", 295000, "ARS", 2]] },
  { name: "AMD Radeon RX 7600", sku: "PCHUB-GPU-013", category: "Placas de Video", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { vram: "8GB", memoriaType: "GDDR6", bus: "128-bit" },
    suppliers: [["TSTOCK", 179, "USD", 4], ["BYTE", 182, "USD", 3]] },
  { name: "AMD Radeon RX 7700 XT", sku: "PCHUB-GPU-014", category: "Placas de Video", brand: "AMD", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { vram: "12GB", memoriaType: "GDDR6", bus: "192-bit" },
    suppliers: [["TSTOCK", 249, "USD", 2], ["BYTE", 252, "USD", 2]] },

  // ── Motherboards ─────────────────────────────────────────────────────────────
  { name: "ASUS TUF Gaming B550-Plus WiFi", sku: "PCHUB-MB-001", category: "Motherboards", brand: "ASUS", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "AM4", chipset: "B550", memoryType: "DDR4", formFactor: "ATX" },
    suppliers: [["NORTE", 132000, "ARS", 4], ["CTEK", 129000, "ARS", 3]] },
  { name: "MSI MAG X570S Torpedo Max", sku: "PCHUB-MB-002", category: "Motherboards", brand: "MSI", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { socket: "AM4", chipset: "X570", memoryType: "DDR4", formFactor: "ATX" },
    suppliers: [["NORTE", 195000, "ARS", 2], ["TSTOCK", 149, "USD", 1]] },
  { name: "ASRock B550M-HDV", sku: "PCHUB-MB-003", category: "Motherboards", brand: "ASRock", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "AM4", chipset: "B550", memoryType: "DDR4", formFactor: "Micro-ATX" },
    suppliers: [["PCWHL", 89000, "ARS", 6], ["GADHUB", 87000, "ARS", 4]] },
  { name: "Gigabyte B650 Aorus Elite AX", sku: "PCHUB-MB-004", category: "Motherboards", brand: "Gigabyte", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { socket: "AM5", chipset: "B650", memoryType: "DDR5", formFactor: "ATX" },
    suppliers: [["TSTOCK", 172, "USD", 3], ["BYTE", 175, "USD", 2]] },
  { name: "ASUS ROG Strix X670E-E Gaming WiFi", sku: "PCHUB-MB-005", category: "Motherboards", brand: "ASUS", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { socket: "AM5", chipset: "X670E", memoryType: "DDR5", formFactor: "ATX" },
    suppliers: [["TSTOCK", 279, "USD", 1], ["BYTE", 285, "USD", 1]] },
  { name: "MSI PRO B660-A DDR4", sku: "PCHUB-MB-006", category: "Motherboards", brand: "MSI", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "1700", chipset: "B660", memoryType: "DDR4", formFactor: "ATX" },
    suppliers: [["NORTE", 139000, "ARS", 5], ["PCWHL", 136000, "ARS", 3]] },
  { name: "Gigabyte H610M H DDR4", sku: "PCHUB-MB-007", category: "Motherboards", brand: "Gigabyte", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "1700", chipset: "H610", memoryType: "DDR4", formFactor: "Micro-ATX" },
    suppliers: [["PCWHL", 88000, "ARS", 7], ["GADHUB", 86000, "ARS", 5], ["NORTE", 91000, "ARS", 3]] },
  { name: "ASUS TUF Gaming Z690-Plus D4", sku: "PCHUB-MB-008", category: "Motherboards", brand: "ASUS", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { socket: "1700", chipset: "Z690", memoryType: "DDR4", formFactor: "ATX" },
    suppliers: [["NORTE", 189000, "ARS", 3], ["TSTOCK", 147, "USD", 1]] },
  { name: "MSI MEG Z890 ACE", sku: "PCHUB-MB-009", category: "Motherboards", brand: "MSI", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.25,
    attributes: { socket: "1851", chipset: "Z890", memoryType: "DDR5", formFactor: "ATX" },
    suppliers: [["TSTOCK", 359, "USD", 1], ["BYTE", 365, "USD", 1]] },
  { name: "Gigabyte B860M Gaming Plus WiFi", sku: "PCHUB-MB-010", category: "Motherboards", brand: "Gigabyte", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { socket: "1851", chipset: "B860", memoryType: "DDR5", formFactor: "Micro-ATX" },
    suppliers: [["TSTOCK", 148, "USD", 3], ["BYTE", 151, "USD", 2]] },
  { name: "ASRock B450M Pro4-F", sku: "PCHUB-MB-011", category: "Motherboards", brand: "ASRock", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "AM4", chipset: "B450", memoryType: "DDR4", formFactor: "Micro-ATX" },
    suppliers: [["NORTE", 79000, "ARS", 5], ["GADHUB", 77000, "ARS", 4]] },
  { name: "MSI H510M-A Pro", sku: "PCHUB-MB-012", category: "Motherboards", brand: "MSI", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { socket: "1200", chipset: "H510", memoryType: "DDR4", formFactor: "Micro-ATX" },
    suppliers: [["PCWHL", 97000, "ARS", 4], ["NORTE", 99000, "ARS", 3]] },

  // ── RAM ───────────────────────────────────────────────────────────────────────
  { name: "Kingston Fury Beast DDR4 8GB 3200MHz", sku: "PCHUB-RAM-001", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { capacidad: "8GB", tipo: "DDR4", velocidad: "3200 MHz" },
    suppliers: [["NORTE", 24000, "ARS", 10], ["PCWHL", 23000, "ARS", 8], ["GADHUB", 22500, "ARS", 6]] },
  { name: "Kingston Fury Beast DDR4 16GB 3200MHz", sku: "PCHUB-RAM-002", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { capacidad: "16GB", tipo: "DDR4", velocidad: "3200 MHz" },
    suppliers: [["NORTE", 44000, "ARS", 8], ["PCWHL", 43000, "ARS", 6], ["CTEK", 45000, "ARS", 4]] },
  { name: "Corsair Vengeance RGB DDR4 16GB 3200MHz", sku: "PCHUB-RAM-003", category: "Memorias RAM", brand: "Corsair", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { capacidad: "16GB", tipo: "DDR4", velocidad: "3200 MHz", rgb: true },
    suppliers: [["TSTOCK", 34, "USD", 5], ["BYTE", 35, "USD", 4]] },
  { name: "Kingston Fury Beast DDR4 32GB 3200MHz", sku: "PCHUB-RAM-004", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "32GB", tipo: "DDR4", velocidad: "3200 MHz" },
    suppliers: [["NORTE", 82000, "ARS", 5], ["PCWHL", 80000, "ARS", 3]] },
  { name: "G.Skill Ripjaws V DDR4 32GB 3600MHz", sku: "PCHUB-RAM-005", category: "Memorias RAM", brand: "G.Skill", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "32GB", tipo: "DDR4", velocidad: "3600 MHz" },
    suppliers: [["TSTOCK", 63, "USD", 3], ["BYTE", 65, "USD", 2]] },
  { name: "Kingston Fury Beast DDR5 16GB 5600MHz", sku: "PCHUB-RAM-006", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { capacidad: "16GB", tipo: "DDR5", velocidad: "5600 MHz" },
    suppliers: [["NORTE", 63000, "ARS", 4], ["CTEK", 65000, "ARS", 3]] },
  { name: "Kingston Fury Beast DDR5 32GB 5600MHz", sku: "PCHUB-RAM-007", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "32GB", tipo: "DDR5", velocidad: "5600 MHz" },
    suppliers: [["TSTOCK", 94, "USD", 3], ["BYTE", 96, "USD", 2]] },
  { name: "Corsair Dominator Platinum DDR5 32GB 6000MHz", sku: "PCHUB-RAM-008", category: "Memorias RAM", brand: "Corsair", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { capacidad: "32GB", tipo: "DDR5", velocidad: "6000 MHz", rgb: true },
    suppliers: [["TSTOCK", 149, "USD", 2], ["BYTE", 152, "USD", 1]] },
  { name: "G.Skill Trident Z5 DDR5 64GB 6000MHz", sku: "PCHUB-RAM-009", category: "Memorias RAM", brand: "G.Skill", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { capacidad: "64GB", tipo: "DDR5", velocidad: "6000 MHz", rgb: true },
    suppliers: [["TSTOCK", 235, "USD", 1], ["BYTE", 239, "USD", 1]] },
  { name: "Kingston Fury Beast DDR4 8GB 2666MHz", sku: "PCHUB-RAM-010", category: "Memorias RAM", brand: "Kingston", warranty: "Lifetime", ivaRate: 0.21, markupRegular: 1.45,
    attributes: { capacidad: "8GB", tipo: "DDR4", velocidad: "2666 MHz" },
    suppliers: [["NORTE", 21000, "ARS", 12], ["GADHUB", 20500, "ARS", 8], ["PCWHL", 20000, "ARS", 6]] },

  // ── Storage ───────────────────────────────────────────────────────────────────
  { name: "Kingston A400 240GB SATA SSD", sku: "PCHUB-STO-001", category: "Almacenamiento", brand: "Kingston", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.40,
    attributes: { capacidad: "240GB", interfaz: "SATA III", tipo: "SSD" },
    suppliers: [["NORTE", 28000, "ARS", 10], ["PCWHL", 27000, "ARS", 8], ["GADHUB", 26500, "ARS", 5]] },
  { name: "Kingston NV2 500GB NVMe", sku: "PCHUB-STO-002", category: "Almacenamiento", brand: "Kingston", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { capacidad: "500GB", interfaz: "NVMe PCIe 4.0", tipo: "SSD" },
    suppliers: [["NORTE", 37000, "ARS", 8], ["CTEK", 36000, "ARS", 5]] },
  { name: "Kingston NV2 1TB NVMe", sku: "PCHUB-STO-003", category: "Almacenamiento", brand: "Kingston", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "1TB", interfaz: "NVMe PCIe 4.0", tipo: "SSD" },
    suppliers: [["NORTE", 65000, "ARS", 7], ["PCWHL", 63000, "ARS", 4], ["TSTOCK", 49, "USD", 3]] },
  { name: "WD Blue SN580 1TB NVMe", sku: "PCHUB-STO-004", category: "Almacenamiento", brand: "WD", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "1TB", interfaz: "NVMe PCIe 4.0", tipo: "SSD", lectura: "4150 MB/s" },
    suppliers: [["TSTOCK", 61, "USD", 5], ["BYTE", 63, "USD", 3]] },
  { name: "Samsung 870 EVO 500GB SATA", sku: "PCHUB-STO-005", category: "Almacenamiento", brand: "Samsung", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "500GB", interfaz: "SATA III", tipo: "SSD" },
    suppliers: [["TSTOCK", 46, "USD", 4], ["BYTE", 47, "USD", 2]] },
  { name: "Seagate Barracuda 1TB HDD 7200RPM", sku: "PCHUB-STO-006", category: "Almacenamiento", brand: "Seagate", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { capacidad: "1TB", interfaz: "SATA III", tipo: "HDD", rpm: "7200" },
    suppliers: [["NORTE", 37000, "ARS", 6], ["GADHUB", 36000, "ARS", 4]] },
  { name: "Seagate Barracuda 2TB HDD 7200RPM", sku: "PCHUB-STO-007", category: "Almacenamiento", brand: "Seagate", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { capacidad: "2TB", interfaz: "SATA III", tipo: "HDD", rpm: "7200" },
    suppliers: [["NORTE", 47000, "ARS", 5], ["PCWHL", 45000, "ARS", 3]] },
  { name: "WD Blue 4TB HDD 5400RPM", sku: "PCHUB-STO-008", category: "Almacenamiento", brand: "WD", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { capacidad: "4TB", interfaz: "SATA III", tipo: "HDD", rpm: "5400" },
    suppliers: [["TSTOCK", 61, "USD", 3], ["BYTE", 62, "USD", 2]] },
  { name: "Samsung 990 Pro 1TB NVMe", sku: "PCHUB-STO-009", category: "Almacenamiento", brand: "Samsung", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { capacidad: "1TB", interfaz: "NVMe PCIe 4.0", tipo: "SSD", lectura: "7450 MB/s" },
    suppliers: [["TSTOCK", 94, "USD", 3], ["BYTE", 96, "USD", 1]] },
  { name: "Kingston NV2 2TB NVMe", sku: "PCHUB-STO-010", category: "Almacenamiento", brand: "Kingston", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { capacidad: "2TB", interfaz: "NVMe PCIe 4.0", tipo: "SSD" },
    suppliers: [["NORTE", 109000, "ARS", 3], ["CTEK", 112000, "ARS", 2]] },

  // ── PSUs ──────────────────────────────────────────────────────────────────────
  { name: "Corsair CV550 550W 80+ Bronze", sku: "PCHUB-PSU-001", category: "Fuentes de Poder", brand: "Corsair", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { potencia: "550W", eficiencia: "80+ Bronze", modular: false },
    suppliers: [["NORTE", 48000, "ARS", 5], ["GADHUB", 47000, "ARS", 4]] },
  { name: "EVGA 650W 80+ Gold", sku: "PCHUB-PSU-002", category: "Fuentes de Poder", brand: "EVGA", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { potencia: "650W", eficiencia: "80+ Gold", modular: false },
    suppliers: [["TSTOCK", 62, "USD", 4], ["BYTE", 63, "USD", 2]] },
  { name: "Corsair RM750e 750W 80+ Gold", sku: "PCHUB-PSU-003", category: "Fuentes de Poder", brand: "Corsair", warranty: "7 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { potencia: "750W", eficiencia: "80+ Gold", modular: true },
    suppliers: [["TSTOCK", 69, "USD", 4], ["NORTE", 90000, "ARS", 2]] },
  { name: "be quiet! Pure Power 12 M 850W 80+ Gold", sku: "PCHUB-PSU-004", category: "Fuentes de Poder", brand: "be quiet!", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { potencia: "850W", eficiencia: "80+ Gold", modular: true },
    suppliers: [["TSTOCK", 94, "USD", 2], ["BYTE", 96, "USD", 1]] },
  { name: "Corsair HX1000 1000W 80+ Platinum", sku: "PCHUB-PSU-005", category: "Fuentes de Poder", brand: "Corsair", warranty: "10 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { potencia: "1000W", eficiencia: "80+ Platinum", modular: true },
    suppliers: [["TSTOCK", 149, "USD", 2], ["BYTE", 152, "USD", 1]] },
  { name: "SeaSonic Focus GX-750W 80+ Gold", sku: "PCHUB-PSU-006", category: "Fuentes de Poder", brand: "SeaSonic", warranty: "10 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { potencia: "750W", eficiencia: "80+ Gold", modular: true },
    suppliers: [["TSTOCK", 79, "USD", 2], ["BYTE", 81, "USD", 1]] },
  { name: "MSI MAG A650BN 650W 80+ Bronze", sku: "PCHUB-PSU-007", category: "Fuentes de Poder", brand: "MSI", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { potencia: "650W", eficiencia: "80+ Bronze", modular: false },
    suppliers: [["NORTE", 57000, "ARS", 5], ["CTEK", 58000, "ARS", 3]] },
  { name: "Thermaltake Toughpower GF1 850W 80+ Gold", sku: "PCHUB-PSU-008", category: "Fuentes de Poder", brand: "Thermaltake", warranty: "10 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { potencia: "850W", eficiencia: "80+ Gold", modular: true },
    suppliers: [["TSTOCK", 86, "USD", 2], ["GADHUB", 110000, "ARS", 1]] },

  // ── Cases ─────────────────────────────────────────────────────────────────────
  { name: "NZXT H510 Mid Tower ATX", sku: "PCHUB-CASE-001", category: "Gabinetes", brand: "NZXT", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { formFactor: "Mid Tower ATX", vidrio: true, usb: "USB 3.0" },
    suppliers: [["TSTOCK", 71, "USD", 3], ["BYTE", 72, "USD", 2]] },
  { name: "Cooler Master MasterBox TD500 Mesh", sku: "PCHUB-CASE-002", category: "Gabinetes", brand: "Cooler Master", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { formFactor: "Mid Tower ATX", malla: true, rgb: true },
    suppliers: [["NORTE", 92000, "ARS", 3], ["GADHUB", 90000, "ARS", 2]] },
  { name: "Phanteks Eclipse P400A", sku: "PCHUB-CASE-003", category: "Gabinetes", brand: "Phanteks", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.35,
    attributes: { formFactor: "Mid Tower ATX", malla: true },
    suppliers: [["TSTOCK", 62, "USD", 3], ["BYTE", 64, "USD", 2]] },
  { name: "Fractal Design Pop Air", sku: "PCHUB-CASE-004", category: "Gabinetes", brand: "Fractal Design", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { formFactor: "Mid Tower ATX" },
    suppliers: [["TSTOCK", 71, "USD", 2], ["BYTE", 72, "USD", 1]] },
  { name: "Lian Li Lancool 216 Mesh", sku: "PCHUB-CASE-005", category: "Gabinetes", brand: "Lian Li", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { formFactor: "Mid Tower ATX", malla: true, rgb: false },
    suppliers: [["TSTOCK", 78, "USD", 2], ["BYTE", 79, "USD", 1]] },
  { name: "Cooler Master HAF 700 EVO", sku: "PCHUB-CASE-006", category: "Gabinetes", brand: "Cooler Master", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { formFactor: "Full Tower E-ATX", rgb: true, pantalla: true },
    suppliers: [["TSTOCK", 142, "USD", 1], ["BYTE", 145, "USD", 1]] },
  { name: "NZXT H1 Elite Mini-ITX", sku: "PCHUB-CASE-007", category: "Gabinetes", brand: "NZXT", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { formFactor: "Mini-ITX" },
    suppliers: [["TSTOCK", 118, "USD", 1], ["BYTE", 120, "USD", 1]] },
  { name: "Thermaltake S100 TG Snow", sku: "PCHUB-CASE-008", category: "Gabinetes", brand: "Thermaltake", warranty: "2 años", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { formFactor: "Micro-ATX", vidrio: true, color: "Blanco" },
    suppliers: [["NORTE", 70000, "ARS", 4], ["GADHUB", 68000, "ARS", 3]] },

  // ── Coolers ───────────────────────────────────────────────────────────────────
  { name: "NZXT Kraken 120 AIO 120mm", sku: "PCHUB-COOL-001", category: "Coolers", brand: "NZXT", warranty: "6 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { tipo: "AIO", radiador: "120mm", rgb: true },
    suppliers: [["TSTOCK", 62, "USD", 3], ["BYTE", 64, "USD", 2]] },
  { name: "Corsair H100i Elite Capellix 240mm", sku: "PCHUB-COOL-002", category: "Coolers", brand: "Corsair", warranty: "5 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { tipo: "AIO", radiador: "240mm", rgb: true },
    suppliers: [["TSTOCK", 94, "USD", 3], ["BYTE", 96, "USD", 1]] },
  { name: "NZXT Kraken Elite 360 AIO", sku: "PCHUB-COOL-003", category: "Coolers", brand: "NZXT", warranty: "6 años", ivaRate: 0.21, markupRegular: 1.28,
    attributes: { tipo: "AIO", radiador: "360mm", rgb: true, pantalla: true },
    suppliers: [["TSTOCK", 157, "USD", 1], ["BYTE", 159, "USD", 1]] },
  { name: "Noctua NH-D15 Tower Cooler", sku: "PCHUB-COOL-004", category: "Coolers", brand: "Noctua", warranty: "6 años", ivaRate: 0.21, markupRegular: 1.30,
    attributes: { tipo: "Torre Doble", ventiladores: 2, altura: "165mm" },
    suppliers: [["TSTOCK", 79, "USD", 2], ["BYTE", 81, "USD", 1]] },
  { name: "be quiet! Dark Rock Pro 4", sku: "PCHUB-COOL-005", category: "Coolers", brand: "be quiet!", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.32,
    attributes: { tipo: "Torre Doble", ventiladores: 2, altura: "163mm" },
    suppliers: [["TSTOCK", 70, "USD", 2], ["BYTE", 72, "USD", 1]] },
  { name: "Thermalright Peerless Assassin 120 SE", sku: "PCHUB-COOL-006", category: "Coolers", brand: "Thermalright", warranty: "3 años", ivaRate: 0.21, markupRegular: 1.38,
    attributes: { tipo: "Torre Doble", ventiladores: 2, altura: "155mm" },
    suppliers: [["NORTE", 48000, "ARS", 5], ["GADHUB", 46500, "ARS", 4], ["CTEK", 49000, "ARS", 2]] },
];

// Insert products and their supplier links/prices

const insProduct = db.prepare(`
  INSERT INTO products (name, sku, category, brand, warranty, iva_rate, markup_regular, attributes, has_supplier_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
`);
const insLink = db.prepare(`
  INSERT INTO product_supplier_links (product_id, supplier_id, supplier_code, supplier_stock_qty, is_active)
  VALUES (?, ?, ?, ?, 1)
`);
const insPrice = db.prepare(`
  INSERT INTO supplier_prices (link_id, raw_price, currency, exchange_rate, final_cost_ars)
  VALUES (?, ?, ?, ?, ?)
`);
const insPriceHistory = db.prepare(`
  INSERT INTO price_history (link_id, raw_price, currency, exchange_rate, final_cost_ars, recorded_at)
  VALUES (?, ?, ?, ?, ?, datetime('now', ? || ' days'))
`);

interface ProductRow {
  id: number;
  bestCostArs: number;
  bestSupplierCode: string;
  bestSupplierName: string;
  bestSupplierStockQty: number;
  hasSupplierStock: number;
}

const productRows: ProductRow[] = [];

const seedTx = db.transaction(() => {
  for (const p of PRODUCTS) {
    const r = insProduct.run(
      p.name, p.sku, p.category, p.brand, p.warranty,
      p.ivaRate, p.markupRegular,
      p.attributes ? JSON.stringify(p.attributes) : null
    );
    const productId = Number(r.lastInsertRowid);

    let bestCostArs = Infinity;
    let bestSupplierCode = "";
    let bestSupplierName = "";
    let bestSupplierStockQty = 0;
    let hasSupplierStock = 0;

    for (const [code, rawPrice, currency, stockQty] of p.suppliers) {
      const sup = SUPPLIERS.find(s => s.code === code)!;
      const finalCostArs = calcFinalCostArs(rawPrice, currency, sup.taxRate, sup.shippingPercent);
      const supplierId = supplierIds[code];

      const lr = insLink.run(productId, supplierId, `${code}-${p.sku.split("-").slice(-1)[0]}`, stockQty);
      const linkId = Number(lr.lastInsertRowid);

      insPrice.run(linkId, rawPrice, currency, currency === "USD" ? EX : null, finalCostArs);

      // Price history — 5 entries over last 14 days
      for (let d = 0; d < 5; d++) {
        const dayOffset = -(Math.floor(d * 14 / 5));
        const histPrice = rawPrice * (1 + (Math.random() - 0.5) * 0.04); // ±2% variation
        const histFinalCost = calcFinalCostArs(histPrice, currency, sup.taxRate, sup.shippingPercent);
        insPriceHistory.run(linkId, histPrice, currency, currency === "USD" ? EX : null, histFinalCost, String(dayOffset));
      }

      if (stockQty > 0) {
        hasSupplierStock = 1;
        if (finalCostArs < bestCostArs) {
          bestCostArs = finalCostArs;
          bestSupplierCode = code;
          bestSupplierName = sup.name;
          bestSupplierStockQty = stockQty;
        }
      }
    }

    productRows.push({ id: productId, bestCostArs, bestSupplierCode, bestSupplierName, bestSupplierStockQty, hasSupplierStock });
  }
});

seedTx();

// Update best_cost_ars on products
const updProduct = db.prepare(`
  UPDATE products SET best_cost_ars = ?, best_supplier_code = ?, best_supplier_name = ?,
    best_supplier_stock_qty = ?, has_supplier_stock = ? WHERE id = ?
`);
const updTx = db.transaction(() => {
  for (const row of productRows) {
    if (row.bestCostArs < Infinity) {
      updProduct.run(row.bestCostArs, row.bestSupplierCode, row.bestSupplierName,
        row.bestSupplierStockQty, row.hasSupplierStock, row.id);
    }
  }
});
updTx();

console.log(`✅ ${PRODUCTS.length} products inserted with supplier links`);

// ─── Buscador seed ────────────────────────────────────────────────────────────

const insBuscador = db.prepare(`
  INSERT INTO buscador_items (group_name, label, filter_category, filter_keywords, sort_order)
  VALUES (?, ?, ?, ?, ?)
`);
const buscadorItems = [
  ["Mothers AMD", "AM4 - Low", '["AM4","A520"]', 1], ["Mothers AMD", "AM4 - Medium", '["AM4","B550"]', 2],
  ["Mothers AMD", "AM4 - High", '["AM4","X570"]', 3], ["Mothers AMD", "AM5 - Low", '["AM5","A620"]', 4],
  ["Mothers AMD", "AM5 - Medium", '["AM5","B650"]', 5], ["Mothers AMD", "AM5 - High", '["AM5","X670"]', 6],
  ["Mothers Intel", "1700 DDR4 - Low", '["1700","H610","DDR4"]', 1], ["Mothers Intel", "1700 DDR4 - Medium", '["1700","B660","DDR4"]', 2],
  ["Mothers Intel", "1700 DDR4 - High", '["1700","Z690","DDR4"]', 3], ["Mothers Intel", "1851 - Low", '["1851","H810"]', 4],
  ["Mothers Intel", "1851 - Medium", '["1851","B860"]', 5], ["Mothers Intel", "1851 - High", '["1851","Z890"]', 6],
  ["RAM DDR4", "8GB", '["8GB","DDR4"]', 1], ["RAM DDR4", "16GB", '["16GB","DDR4"]', 2], ["RAM DDR4", "32GB", '["32GB","DDR4"]', 3],
  ["RAM DDR5", "16GB", '["16GB","DDR5"]', 1], ["RAM DDR5", "32GB", '["32GB","DDR5"]', 2], ["RAM DDR5", "64GB", '["64GB","DDR5"]', 3],
  ["Storage SSD", "240GB SATA", '["240GB","SATA"]', 1], ["Storage SSD", "500GB NVMe", '["500GB","NVMe"]', 2],
  ["Storage SSD", "1TB NVMe", '["1TB","NVMe"]', 3], ["Storage SSD", "2TB NVMe", '["2TB","NVMe"]', 4],
];
const buscTx = db.transaction(() => {
  for (const [g, l, kw, o] of buscadorItems) {
    insBuscador.run(g, l, g, kw, o);
  }
});
buscTx();
console.log(`✅ ${buscadorItems.length} buscador items inserted`);

// ─── Combo Templates + Slots ──────────────────────────────────────────────────

const insCombo = db.prepare(`
  INSERT INTO combo_templates (name, sku, is_active, notes) VALUES (?, ?, 1, ?)
`);
const insSlot = db.prepare(`
  INSERT INTO combo_slots (template_id, slot_name, sort_order, slot_type, filter_category, filter_keywords, filter_must_keywords, quantity)
  VALUES (?, ?, ?, 'auto', ?, ?, ?, ?)
`);

const combos = [
  {
    name: "PC Gamer Entry Level",
    sku: "PCHUB-PC-001",
    notes: "Armar PC gamer de entrada ideal para 1080p",
    slots: [
      ["Procesador", 0, "Procesadores", '["i5","12400"]', null, 1],
      ["Motherboard", 1, "Motherboards", '["B660","DDR4","1700"]', null, 1],
      ["RAM", 2, "Memorias RAM", '["16GB","DDR4"]', null, 1],
      ["Placa de Video", 3, "Placas de Video", '["RTX 3060"]', null, 1],
      ["Almacenamiento", 4, "Almacenamiento", '["1TB","NVMe"]', null, 1],
      ["Fuente", 5, "Fuentes de Poder", '["650W","Gold"]', null, 1],
      ["Gabinete", 6, "Gabinetes", '["Mid Tower"]', null, 1],
    ],
  },
  {
    name: "PC Gamer Media Gama",
    sku: "PCHUB-PC-002",
    notes: "PC gamer media gama para 1440p fluido",
    slots: [
      ["Procesador", 0, "Procesadores", '["Ryzen 7","7700"]', null, 1],
      ["Motherboard", 1, "Motherboards", '["B650","DDR5","AM5"]', null, 1],
      ["RAM", 2, "Memorias RAM", '["32GB","DDR5"]', null, 1],
      ["Placa de Video", 3, "Placas de Video", '["RTX 4060 Ti"]', null, 1],
      ["Almacenamiento", 4, "Almacenamiento", '["1TB","NVMe"]', null, 1],
      ["Fuente", 5, "Fuentes de Poder", '["750W","Gold"]', null, 1],
      ["Gabinete", 6, "Gabinetes", '["Mid Tower"]', null, 1],
    ],
  },
  {
    name: "PC Oficina Básica",
    sku: "PCHUB-PC-003",
    notes: "PC para oficina, navegación y trabajo cotidiano",
    slots: [
      ["Procesador", 0, "Procesadores", '["i3","13100"]', null, 1],
      ["Motherboard", 1, "Motherboards", '["H610","DDR4"]', null, 1],
      ["RAM", 2, "Memorias RAM", '["8GB","DDR4"]', null, 1],
      ["Almacenamiento", 3, "Almacenamiento", '["240GB","SATA"]', null, 1],
      ["Fuente", 4, "Fuentes de Poder", '["550W","Bronze"]', null, 1],
      ["Gabinete", 5, "Gabinetes", '["Micro-ATX"]', null, 1],
    ],
  },
  {
    name: "Workstation Profesional",
    sku: "PCHUB-PC-004",
    notes: "Workstation de alto rendimiento para diseño y edición",
    slots: [
      ["Procesador", 0, "Procesadores", '["Ryzen 9"]', null, 1],
      ["Motherboard", 1, "Motherboards", '["X670","DDR5"]', null, 1],
      ["RAM", 2, "Memorias RAM", '["64GB","DDR5"]', null, 1],
      ["Placa de Video", 3, "Placas de Video", '["RX 7700"]', null, 1],
      ["Almacenamiento SSD", 4, "Almacenamiento", '["2TB","NVMe"]', null, 1],
      ["Almacenamiento HDD", 5, "Almacenamiento", '["4TB","HDD"]', null, 1],
      ["Fuente", 6, "Fuentes de Poder", '["1000W","Platinum"]', null, 1],
      ["Gabinete", 7, "Gabinetes", '["Full Tower"]', null, 1],
      ["Cooler", 8, "Coolers", '["360mm","AIO"]', null, 1],
    ],
  },
];

const comboTx = db.transaction(() => {
  for (const combo of combos) {
    const r = insCombo.run(combo.name, combo.sku, combo.notes);
    const templateId = Number(r.lastInsertRowid);
    for (const [slotName, order, cat, kw, mustKw, qty] of combo.slots) {
      insSlot.run(templateId, slotName, order, cat, kw, mustKw, qty);
    }
  }
});
comboTx();
console.log(`✅ ${combos.length} combo templates inserted`);

// ─── Purchase Orders ──────────────────────────────────────────────────────────

const insPO = db.prepare(`INSERT INTO purchase_orders (supplier_id, status, supplier_order_number, notes) VALUES (?, ?, ?, ?)`);
const insPOI = db.prepare(`
  INSERT INTO purchase_order_items (purchase_order_id, product_id, supplier_id, supplier_code, quantity, unit_cost_ars, goes_to_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// PO1: Open — NorteDistrib
const po1 = Number(insPO.run(supplierIds["NORTE"], "open", "NORTE-2026-0312", "Pedido de CPUs y RAM").lastInsertRowid);
insPOI.run(po1, productRows[0].id, supplierIds["NORTE"], "NORTE-CPU001", 2, 145000, 1);  // Ryzen 5 5600X
insPOI.run(po1, productRows[5].id, supplierIds["NORTE"], "NORTE-CPU006", 3, 152000, 1);  // i5-12400
insPOI.run(po1, productRows[12].id, supplierIds["NORTE"], "NORTE-RAM001", 5, 24000, 1);  // 8GB DDR4

// PO2: Closed — TechStock
const po2 = Number(insPO.run(supplierIds["TSTOCK"], "closed", "TSTOCK-INV-889", "Compra GPUs y storage").lastInsertRowid);
db.prepare("UPDATE purchase_orders SET closed_at = datetime('now', '-10 days'), total_paid = 1450000 WHERE id = ?").run(po2);
insPOI.run(po2, productRows[15].id, supplierIds["TSTOCK"], "TSTOCK-GPU06", 2, 195 * EX, 1); // RTX 3060
insPOI.run(po2, productRows[22].id, supplierIds["TSTOCK"], "TSTOCK-STO03", 3, 61 * EX, 1);  // WD Blue NVMe

// PO3: Open — PCWholesale (varios items)
const po3 = Number(insPO.run(supplierIds["PCWHL"], "open", null, "Reposición de stock habitual").lastInsertRowid);
insPOI.run(po3, productRows[11].id, supplierIds["PCWHL"], "PCWHL-CPU012", 4, 115000, 1); // i3-13100
insPOI.run(po3, productRows[6].id, supplierIds["PCWHL"], "PCWHL-MB006", 2, 136000, 0);   // MSI PRO B660
insPOI.run(po3, productRows[13].id, supplierIds["PCWHL"], "PCWHL-RAM002", 6, 43000, 1);  // 16GB DDR4
insPOI.run(po3, productRows[20].id, supplierIds["PCWHL"], "PCWHL-STO001", 4, 27000, 1);  // 240GB SATA
insPOI.run(po3, productRows[28].id, supplierIds["PCWHL"], "PCWHL-PSU007", 2, 57000, 0);  // MSI PSU 650W

console.log("✅ 3 purchase orders inserted");

// ─── Quote Sessions ───────────────────────────────────────────────────────────

const insSession = db.prepare(`
  INSERT INTO quote_sessions (client_name, client_phone, client_email, status, exchange_rate_at_creation)
  VALUES (?, ?, ?, ?, ?)
`);
const insQuote = db.prepare(`INSERT INTO quotes (session_id, title, sort_order) VALUES (?, ?, ?)`);
const insQI = db.prepare(`
  INSERT INTO quote_items (quote_id, sort_order, item_name, item_type, filter_category, filter_keywords, quantity)
  VALUES (?, ?, ?, 'auto', ?, ?, ?)
`);

// Session 1: open
const s1 = Number(insSession.run("Juan García", "+54 11 4567-8901", "juan.garcia@email.com", "open", 1250).lastInsertRowid);
const q1 = Number(insQuote.run(s1, "PC Gamer 1080p", 0).lastInsertRowid);
insQI.run(q1, 0, "Procesador", "Procesadores", '["i5","12400"]', 1);
insQI.run(q1, 1, "Motherboard", "Motherboards", '["B660","DDR4"]', 1);
insQI.run(q1, 2, "Memoria RAM", "Memorias RAM", '["16GB","DDR4"]', 1);
insQI.run(q1, 3, "Placa de Video", "Placas de Video", '["RTX 3060"]', 1);
insQI.run(q1, 4, "Almacenamiento", "Almacenamiento", '["1TB","NVMe"]', 1);
insQI.run(q1, 5, "Fuente", "Fuentes de Poder", '["650W","Gold"]', 1);
insQI.run(q1, 6, "Gabinete", "Gabinetes", null, 1);

// Session 2: following_up with 2 options
const s2 = Number(insSession.run("María López", "+54 11 5678-9012", null, "following_up", 1250).lastInsertRowid);
const q2a = Number(insQuote.run(s2, "Opción Budget", 0).lastInsertRowid);
insQI.run(q2a, 0, "Procesador", "Procesadores", '["Ryzen 5","5600"]', 1);
insQI.run(q2a, 1, "Motherboard", "Motherboards", '["B550","AM4"]', 1);
insQI.run(q2a, 2, "RAM", "Memorias RAM", '["16GB","DDR4"]', 1);
insQI.run(q2a, 3, "GPU", "Placas de Video", '["RTX 4060"]', 1);
insQI.run(q2a, 4, "SSD", "Almacenamiento", '["1TB","NVMe"]', 1);
const q2b = Number(insQuote.run(s2, "Opción Premium", 1).lastInsertRowid);
insQI.run(q2b, 0, "Procesador", "Procesadores", '["Ryzen 7","7700"]', 1);
insQI.run(q2b, 1, "Motherboard", "Motherboards", '["B650","AM5","DDR5"]', 1);
insQI.run(q2b, 2, "RAM", "Memorias RAM", '["32GB","DDR5"]', 1);
insQI.run(q2b, 3, "GPU", "Placas de Video", '["RTX 4060 Ti"]', 1);
insQI.run(q2b, 4, "SSD", "Almacenamiento", '["1TB","NVMe"]', 1);
insQI.run(q2b, 5, "AIO", "Coolers", '["240mm","AIO"]', 1);

// Session 3: closed
const s3 = Number(insSession.run("Carlos Rodríguez", "+54 9 11 2345-6789", "carlos.r@empresa.com", "closed_wc", 1250).lastInsertRowid);
db.prepare("UPDATE quote_sessions SET updated_at = datetime('now', '-5 days') WHERE id = ?").run(s3);

console.log("✅ 3 quote sessions with quotes inserted");

// ─── Settings ─────────────────────────────────────────────────────────────────

const insSetting = db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`);
const settings: [string, unknown][] = [
  ["company_razon_social", "PCHub Argentina S.R.L."],
  ["company_cuit", "30-71234567-8"],
  ["company_domicilio", "Av. Santa Fe 2345, CABA, Argentina"],
  ["company_iva_condition", "Responsable Inscripto"],
  ["company_ingresos_brutos", "30-71234567-8"],
  ["company_inicio_actividades", "15/03/2021"],
  ["company_logo_url", ""],
];
const settingsTx = db.transaction(() => {
  for (const [k, v] of settings) {
    insSetting.run(k, JSON.stringify(v));
  }
});
settingsTx();
console.log("✅ Company settings inserted");

// ─── Historical Margins ───────────────────────────────────────────────────────

const insHM = db.prepare(`
  INSERT INTO historical_margins (year, month, week, cash_revenue, stock_value, total_cost, cash_margin, total_margin, order_count)
  VALUES (?, ?, ?, 0, ?, 0, ?, ?, ?)
`);

const hmData: [number, number, number | null, number, number, number, number][] = [
  [2024,  1, null, 180000, 82000, 262000, 14],
  [2024,  2, null, 210000, 95000, 305000, 18],
  [2024,  3, null, 340000, 145000, 485000, 26],
  [2024,  4, null, 295000, 112000, 407000, 22],
  [2024,  5, null, 380000, 160000, 540000, 30],
  [2024,  6, null, 310000, 130000, 440000, 24],
  [2024,  7, null, 425000, 175000, 600000, 33],
  [2024,  8, null, 490000, 198000, 688000, 38],
  [2024,  9, null, 365000, 148000, 513000, 28],
  [2024, 10, null, 520000, 210000, 730000, 40],
  [2024, 11, null, 580000, 235000, 815000, 45],
  [2024, 12, null, 650000, 268000, 918000, 51],
  [2025,  1, null, 410000, 168000, 578000, 32],
  [2025,  2, null, 445000, 181000, 626000, 35],
  [2025,  3, null, 495000, 198000, 693000, 38],
  [2025,  4, null, 550000, 218000, 768000, 43],
  [2025,  5, null, 480000, 194000, 674000, 37],
  [2025,  6, null, 515000, 207000, 722000, 40],
  [2025,  7, null, 590000, 238000, 828000, 46],
  [2025,  8, null, 620000, 249000, 869000, 48],
  [2025,  9, null, 545000, 220000, 765000, 42],
  [2025, 10, null, 640000, 258000, 898000, 50],
  [2025, 11, null, 700000, 282000, 982000, 55],
  [2025, 12, null, 760000, 305000, 1065000, 60],
  [2026,  1, null, 520000, 210000, 730000, 40],
  [2026,  2, null, 485000, 196000, 681000, 38],
  [2026,  3, 1, 125000, 51000, 176000, 10],
  [2026,  3, 2, 132000, 54000, 186000, 11],
  [2026,  3, 3, 119000, 48000, 167000, 9],
];

const hmTx = db.transaction(() => {
  for (const [yr, mo, wk, stockVal, cashMgn, totalMgn, orders] of hmData) {
    insHM.run(yr, mo, wk ?? null, stockVal, cashMgn, totalMgn, orders);
  }
});
hmTx();
console.log("✅ Historical margins inserted");

// ─── Admin User ───────────────────────────────────────────────────────────────

const passwordHash = bcrypt.hashSync("demo123", 12);
db.prepare(`
  INSERT INTO users (email, password_hash, name, role, is_active, totp_enabled)
  VALUES (?, ?, ?, 'SUPER_ADMIN', 1, 0)
`).run("admin@pchub.com.ar", passwordHash, "Admin PCHub");
console.log("✅ Admin user created: admin@pchub.com.ar / demo123");

// ─── Finalize ─────────────────────────────────────────────────────────────────

db.pragma("optimize");
db.close();

const stats = fs.statSync(DB_PATH);
console.log(`\n✅ demo-seed.db built at ${DB_PATH}`);
console.log(`   Size: ${(stats.size / 1024).toFixed(1)} KB`);
console.log(`   Products: ${PRODUCTS.length}`);
console.log(`   Suppliers: ${SUPPLIERS.length}`);
console.log(`   Combos: ${combos.length}`);
