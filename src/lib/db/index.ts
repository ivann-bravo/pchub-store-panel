import BetterSqlite from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

// ── Lazy singleton — database is opened only on the first real request,
//    never during `next build` (which imports modules but never calls handlers).
let _db: BetterSQLite3Database<typeof schema> | null = null;

// Resolves the DB path at runtime. In DEMO_MODE, copies the pre-seeded demo DB
// to /tmp on the first cold start (Vercel serverless compatible).
function resolveDbPath(): string {
  if (process.env.DEMO_MODE === "true") {
    const tmpPath = "/tmp/pchub-demo.db";
    if (!fs.existsSync(tmpPath)) {
      const seedPath = path.join(process.cwd(), "data", "demo-seed.db");
      fs.copyFileSync(seedPath, tmpPath);
      console.log("[demo] Copied demo-seed.db to /tmp/pchub-demo.db");
    }
    return tmpPath;
  }
  return path.join(process.cwd(), "data", "pchub-demo.db");
}

function getDb(): BetterSQLite3Database<typeof schema> {
  if (_db) return _db;

  const dbPath = resolveDbPath();

  // Ensure the data directory exists (safety guard for any environment)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new BetterSqlite(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("cache_size = -32000"); // 32 MB page cache

  // ── Performance indexes (CREATE IF NOT EXISTS — safe to re-run) ──────────

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_prices_link_id ON supplier_prices(link_id)`);
  // Covering index: lets the best-price subquery resolve link_id → final_cost_ars without a heap lookup
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_prices_link_cost ON supplier_prices(link_id, final_cost_ars)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_psl_product_id ON product_supplier_links(product_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_psl_supplier_id ON product_supplier_links(supplier_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_psl_active_stock ON product_supplier_links(is_active, supplier_stock_qty)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_psl_supplier_active_code ON product_supplier_links(supplier_id, is_active, supplier_code)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_local_stock ON products(local_stock)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_has_supplier_stock ON products(has_supplier_stock)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_category_brand ON products(category, brand)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_items_catalog_id ON supplier_catalog_items(catalog_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_items_supplier_code ON supplier_catalog_items(supplier_code)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_catalogs_supplier_id ON supplier_catalogs(supplier_id)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_link_id ON price_history(link_id)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_exchange_rates_fetched_at ON exchange_rates(fetched_at)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)`);

  // ── Migrations (safe to re-run) ───────────────────────────────────────────
  try { sqlite.exec(`ALTER TABLE suppliers ADD COLUMN connector_type TEXT NOT NULL DEFAULT 'manual'`); } catch {}
  try { sqlite.exec(`ALTER TABLE suppliers ADD COLUMN api_config TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE suppliers ADD COLUMN notes TEXT`); } catch {}
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL REFERENCES product_supplier_links(id) ON DELETE CASCADE,
      raw_price REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL,
      final_cost_ars REAL NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_link_recorded ON price_history(link_id, recorded_at)`);
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN internal_tax_rate REAL NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN own_price_regular REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN own_price_offer REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN own_cost_usd REAL`); } catch {}

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS product_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      price_regular REAL,
      price_offer REAL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_product_price_history_product_recorded ON product_price_history(product_id, recorded_at)`);

  sqlite.exec(`
    INSERT INTO product_price_history (product_id, price_regular, price_offer, recorded_at)
    SELECT id, own_price_regular, own_price_offer, updated_at
    FROM products
    WHERE own_price_regular IS NOT NULL
    AND id NOT IN (SELECT DISTINCT product_id FROM product_price_history)
  `);

  try { sqlite.exec(`ALTER TABLE suppliers ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE product_supplier_links ADD COLUMN supplier_stock_qty INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE suppliers ADD COLUMN stock_config TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE product_supplier_links ADD COLUMN stock_locked INTEGER NOT NULL DEFAULT 0`); } catch {}

  sqlite.exec(`
    DELETE FROM supplier_catalog_items WHERE catalog_id IN (
      SELECT id FROM supplier_catalogs WHERE supplier_id IN (
        SELECT s.id FROM suppliers s
        WHERE UPPER(s.code) = 'INVID'
        AND s.id NOT IN (SELECT DISTINCT supplier_id FROM product_supplier_links)
      )
    )
  `);
  sqlite.exec(`
    DELETE FROM supplier_catalogs WHERE supplier_id IN (
      SELECT s.id FROM suppliers s
      WHERE UPPER(s.code) = 'INVID'
      AND s.id NOT IN (SELECT DISTINCT supplier_id FROM product_supplier_links)
    )
  `);
  sqlite.exec(`
    DELETE FROM suppliers
    WHERE UPPER(code) = 'INVID'
    AND id NOT IN (SELECT DISTINCT supplier_id FROM product_supplier_links)
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS dismissed_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      supplier_code TEXT NOT NULL,
      dismiss_type TEXT NOT NULL CHECK(dismiss_type IN ('match', 'create')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS unique_dismissed_match ON dismissed_matches(supplier_id, supplier_code, dismiss_type)`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS combo_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT NOT NULL UNIQUE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_total_price REAL,
      last_has_stock INTEGER,
      last_refreshed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS combo_slots (
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
      resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      resolved_price REAL,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_combo_slots_template ON combo_slots(template_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_combo_templates_sku ON combo_templates(sku)`);

  {
    const slotCols = sqlite.prepare("PRAGMA table_info(combo_slots)").all() as { name: string }[];
    const hasFixedComboId = slotCols.some((c) => c.name === "fixed_combo_id");
    if (!hasFixedComboId) {
      const existingSlots = sqlite.prepare("SELECT * FROM combo_slots").all() as Record<string, unknown>[];
      sqlite.pragma("foreign_keys = OFF");
      sqlite.exec(`DROP TABLE IF EXISTS combo_slots`);
      sqlite.exec(`
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
          resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
          resolved_price REAL,
          resolved_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_combo_slots_template ON combo_slots(template_id)`);
      if (existingSlots.length > 0) {
        const ins = sqlite.prepare(
          `INSERT INTO combo_slots (id, template_id, slot_name, sort_order, slot_type, quantity, fixed_product_id, fixed_combo_id, filter_category, filter_keywords, resolved_product_id, resolved_price, resolved_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
        );
        for (const row of existingSlots) {
          ins.run(row.id, row.template_id, row.slot_name, row.sort_order, row.slot_type, row.quantity,
            row.fixed_product_id, row.filter_category, row.filter_keywords,
            row.resolved_product_id, row.resolved_price, row.resolved_at, row.created_at);
        }
      }
      sqlite.pragma("foreign_keys = ON");
    }
  }

  try { sqlite.exec(`ALTER TABLE products ADD COLUMN attributes TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE combo_slots ADD COLUMN filter_attributes TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE buscador_items ADD COLUMN filter_attributes TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE buscador_items ADD COLUMN filter_must_keywords TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE combo_slots ADD COLUMN filter_must_keywords TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE buscador_items ADD COLUMN filter_min_price REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE buscador_items ADD COLUMN filter_max_price REAL`); } catch {}

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS buscador_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_name TEXT NOT NULL,
      label TEXT NOT NULL,
      filter_category TEXT NOT NULL,
      filter_keywords TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      resolved_product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      resolved_product_name TEXT,
      resolved_price REAL,
      resolved_has_stock INTEGER,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const buscadorSeed = [
    { group: "Mothers AMD", label: "AM4 - Low",    kw: '["AM4","A520"]',       order: 1 },
    { group: "Mothers AMD", label: "AM4 - Medium", kw: '["AM4","B550"]',       order: 2 },
    { group: "Mothers AMD", label: "AM4 - High",   kw: '["AM4","X570"]',       order: 3 },
    { group: "Mothers AMD", label: "AM5 - Low",    kw: '["AM5","A620"]',       order: 4 },
    { group: "Mothers AMD", label: "AM5 - Medium", kw: '["AM5","B650"]',       order: 5 },
    { group: "Mothers AMD", label: "AM5 - High",   kw: '["AM5","X670"]',       order: 6 },
    { group: "Mothers Intel", label: "1200 - Low",          kw: '["1200","H510"]',          order: 1 },
    { group: "Mothers Intel", label: "1200 - Medium",       kw: '["1200","B560"]',          order: 2 },
    { group: "Mothers Intel", label: "1200 - High",         kw: '["1200","Z590"]',          order: 3 },
    { group: "Mothers Intel", label: "1700 DDR4 - Low",     kw: '["1700","H610","DDR4"]',   order: 4 },
    { group: "Mothers Intel", label: "1700 DDR4 - Medium",  kw: '["1700","B660","DDR4"]',   order: 5 },
    { group: "Mothers Intel", label: "1700 DDR4 - High",    kw: '["1700","Z690","DDR4"]',   order: 6 },
    { group: "Mothers Intel", label: "1700 DDR5 - Low",     kw: '["1700","H610","DDR5"]',   order: 7 },
    { group: "Mothers Intel", label: "1700 DDR5 - Medium",  kw: '["1700","B660","DDR5"]',   order: 8 },
    { group: "Mothers Intel", label: "1700 DDR5 - High",    kw: '["1700","Z690","DDR5"]',   order: 9 },
    { group: "Mothers Intel", label: "1851 - Low",          kw: '["1851","H810"]',          order: 10 },
    { group: "Mothers Intel", label: "1851 - Medium",       kw: '["1851","B860"]',          order: 11 },
    { group: "Mothers Intel", label: "1851 - High",         kw: '["1851","Z890"]',          order: 12 },
    { group: "RAM DDR4", label: "8GB - Low",  kw: '["8GB","DDR4"]',  order: 1 },
    { group: "RAM DDR4", label: "16GB - Low", kw: '["16GB","DDR4"]', order: 2 },
    { group: "RAM DDR4", label: "32GB - Low", kw: '["32GB","DDR4"]', order: 3 },
    { group: "RAM DDR5", label: "8GB",  kw: '["8GB","DDR5"]',  order: 1 },
    { group: "RAM DDR5", label: "16GB", kw: '["16GB","DDR5"]', order: 2 },
    { group: "RAM DDR5", label: "32GB", kw: '["32GB","DDR5"]', order: 3 },
    { group: "Storage SSD", label: "120GB SATA", kw: '["120GB","SATA"]', order: 1 },
    { group: "Storage SSD", label: "120GB NVMe", kw: '["120GB","NVMe"]', order: 2 },
    { group: "Storage SSD", label: "240GB SATA", kw: '["240GB","SATA"]', order: 3 },
    { group: "Storage SSD", label: "240GB NVMe", kw: '["240GB","NVMe"]', order: 4 },
    { group: "Storage SSD", label: "500GB SATA", kw: '["500GB","SATA"]', order: 5 },
    { group: "Storage SSD", label: "500GB NVMe", kw: '["500GB","NVMe"]', order: 6 },
    { group: "Storage SSD", label: "1TB SATA",   kw: '["1TB","SATA"]',  order: 7 },
    { group: "Storage SSD", label: "1TB NVMe",   kw: '["1TB","NVMe"]',  order: 8 },
    { group: "Storage SSD", label: "2TB SATA",   kw: '["2TB","SATA"]',  order: 9 },
    { group: "Storage SSD", label: "2TB NVMe",   kw: '["2TB","NVMe"]',  order: 10 },
  ];

  const insertBuscador = sqlite.prepare(`
    INSERT OR IGNORE INTO buscador_items (group_name, label, filter_category, filter_keywords, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `);
  const seedBuscador = sqlite.transaction(() => {
    for (const item of buscadorSeed) {
      insertBuscador.run(item.group, item.label, item.group, item.kw, item.order);
    }
  });
  const buscadorCount = sqlite.prepare("SELECT COUNT(*) as cnt FROM buscador_items").get() as { cnt: number };
  if (buscadorCount.cnt === 0) {
    seedBuscador();
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS woo_export_snapshots (
      product_id    INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      woocommerce_id INTEGER NOT NULL,
      stock_qty     INTEGER NOT NULL,
      stock_status  TEXT NOT NULL,
      post_status   TEXT NOT NULL,
      regular_price INTEGER,
      sale_price    INTEGER,
      offer_start   TEXT,
      offer_end     TEXT,
      exported_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_snapshots_woo_id ON woo_export_snapshots(woocommerce_id)`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
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
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN totp_secret TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE users ADD COLUMN last_login_at TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE combo_templates ADD COLUMN description TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN short_description TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN description TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN best_cost_ars REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN best_supplier_code TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN best_supplier_name TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN best_supplier_stock_qty INTEGER NOT NULL DEFAULT 0`); } catch {}

  // WooCommerce integration columns
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN gallery_images TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_category_ids TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_sync_pending INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_last_synced_at TEXT`); } catch {}

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS woo_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      woo_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      parent_id INTEGER NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS woo_attribute_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_key TEXT NOT NULL UNIQUE,
      woo_attribute_id INTEGER NOT NULL,
      woo_attribute_name TEXT NOT NULL,
      woo_attribute_slug TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // WooCommerce sync safety columns + table
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_synced_regular_price REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_synced_offer_price REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_synced_stock_qty INTEGER`); } catch {}
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS woo_sync_blocked (
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
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_sync_blocked_status ON woo_sync_blocked(status)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_sync_blocked_product ON woo_sync_blocked(product_id)`);

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_psl_product_active_stock ON product_supplier_links(product_id, is_active, supplier_stock_qty)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_products_best_cost ON products(best_cost_ars)`);

  // Populate best cost columns for existing data (idempotent — only updates NULL rows)
  {
    const unpopulated = sqlite.prepare(`SELECT COUNT(*) as cnt FROM products WHERE best_cost_ars IS NULL AND id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE is_active = 1 AND supplier_stock_qty > 0)`).get() as { cnt: number };
    if (unpopulated.cnt > 0) {
      sqlite.exec(`
        UPDATE products SET
          best_cost_ars = (
            SELECT MIN(sp.final_cost_ars) FROM product_supplier_links psl
            JOIN supplier_prices sp ON sp.link_id = psl.id
            WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
          ),
          best_supplier_code = (
            SELECT s.code FROM product_supplier_links psl
            JOIN supplier_prices sp ON sp.link_id = psl.id
            JOIN suppliers s ON s.id = psl.supplier_id
            WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
            ORDER BY sp.final_cost_ars ASC LIMIT 1
          ),
          best_supplier_name = (
            SELECT s.name FROM product_supplier_links psl
            JOIN supplier_prices sp ON sp.link_id = psl.id
            JOIN suppliers s ON s.id = psl.supplier_id
            WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
            ORDER BY sp.final_cost_ars ASC LIMIT 1
          ),
          best_supplier_stock_qty = COALESCE((
            SELECT psl.supplier_stock_qty FROM product_supplier_links psl
            JOIN supplier_prices sp ON sp.link_id = psl.id
            WHERE psl.product_id = products.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
            ORDER BY sp.final_cost_ars ASC LIMIT 1
          ), 0)
        WHERE id IN (SELECT DISTINCT product_id FROM product_supplier_links WHERE is_active = 1 AND supplier_stock_qty > 0)
      `);
    }
  }

  // Purchase orders
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      supplier_order_number TEXT,
      total_paid REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status)`);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
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
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_poi_order ON purchase_order_items(purchase_order_id)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_poi_product ON purchase_order_items(product_id)`);
  try { sqlite.exec(`ALTER TABLE purchase_order_items ADD COLUMN stock_alert_status TEXT`); } catch {}

  // Historical margins table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS historical_margins (
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
    )
  `);

  // ── Seed historical margins (only if table is empty) ─────────────────────────
  // cashMargin / stockValue only — raw revenue/cost breakdown not available for pre-system periods.
  const hmCount = (sqlite.prepare("SELECT COUNT(*) as n FROM historical_margins").get() as { n: number }).n;
  if (hmCount === 0) {
    // [year, month, week|null, cashMargin, stockValue]
    const hmSeed: [number, number, number | null, number, number][] = [
      // 2023
      [2023,  1, null,   120100,       0],
      [2023,  2, null,   517600,       0],
      [2023,  3, null,   441100,       0],
      [2023,  4, null,   467600,       0],
      [2023,  5, null,    91600,  305000],
      [2023,  6, null,   367800,   62700],
      [2023,  7, null,   342900,   59400],
      [2023,  8, null,   480700,       0],
      [2023,  9, null,   259800,       0],
      [2023, 10, null,   999000, 1478000],
      [2023, 11, null,   363900,  759000],
      [2023, 12, null,   192900,   79000],
      // 2024
      [2024,  1, null,   705200,       0],
      [2024,  2, null,   103000,  291000],
      [2024,  3, null,   556200, 1358300],
      [2024,  4, null, -3311300, 4874700],
      [2024,  5, null,  -781500, 2085500],
      [2024,  6, null, -1259600, 2212000],
      [2024,  7, null, -1565900, 2734700],
      [2024,  8, null, -2439600, 4131300],
      [2024,  9, null,   162700, 1323000],
      [2024, 10, null,  1077400,  578300],
      [2024, 11, null,  -323800,  743000],
      [2024, 12, null,   316400,  369000],
      // 2025
      [2025,  1, null,   853500,   25700],
      [2025,  2, null,  1016000,       0],
      [2025,  3, null,  1552500,  918600],
      [2025,  4, null,  1069900,  687000],
      [2025,  5, null,   296900,  776500],
      [2025,  6, null,   614300,   40500],
      [2025,  7, null,  1135400,  268500],
      [2025,  8, null,  1208200,   52000],
      [2025,  9, null,   307400,  458000],
      [2025, 10, null,  1226100,   83000],
      [2025, 11, null,   578500,   55000],
      [2025, 12, null,  1208200,  236000],
      // 2026
      [2026,  1, null,    51100,  845000],
      [2026,  2, null, -2333400, 4162700],
      // March 2026 — weekly data (weeks 1-3)
      [2026,  3,    1, -4438500, 5360000],
      [2026,  3,    2,   251900,       0],
      [2026,  3,    3,   124700,       0],
    ];
    const hmInsert = sqlite.prepare(
      `INSERT INTO historical_margins (year, month, week, cash_revenue, stock_value, total_cost, cash_margin, total_margin, order_count)
       VALUES (?, ?, ?, 0, ?, 0, ?, ?, 0)`
    );
    const hmSeedTx = sqlite.transaction(() => {
      for (const [yr, mo, wk, cashMgn, stockVal] of hmSeed) {
        hmInsert.run(yr, mo, wk ?? null, stockVal, cashMgn, cashMgn + stockVal);
      }
    });
    hmSeedTx();
  }

  // Manual WC private override
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_manual_private INTEGER NOT NULL DEFAULT 0`); } catch {}

  // Image audit columns
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN image_audit_status TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN image_audit_data TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_main_image_attachment_id INTEGER`); } catch {}
  try { sqlite.exec(`ALTER TABLE products ADD COLUMN woo_gallery_attachment_ids TEXT`); } catch {}

  // Woo sync log — records each successful sync (pull or push), 7-day rolling window
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS woo_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      panel_id INTEGER,
      woo_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'pull',
      regular_price REAL,
      offer_price REAL,
      stock_qty INTEGER,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_sync_log_synced_at ON woo_sync_log(synced_at DESC)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_sync_log_woo_id ON woo_sync_log(woo_id)`);

  // Change tracking: prev values recorded at sync time (populated going forward)
  try { sqlite.exec(`ALTER TABLE woo_sync_log ADD COLUMN prev_regular_price REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE woo_sync_log ADD COLUMN prev_offer_price REAL`); } catch {}
  try { sqlite.exec(`ALTER TABLE woo_sync_log ADD COLUMN prev_stock_qty INTEGER`); } catch {}
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_woo_sync_log_panel_id ON woo_sync_log(panel_id)`);

  // ── Quote / Presupuesto tables ────────────────────────────────────────────────
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quote_sessions (
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
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_quote_sessions_status ON quote_sessions(status)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_quote_sessions_updated ON quote_sessions(updated_at DESC)`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES quote_sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Opción 1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      resolved_total REAL,
      resolved_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_session ON quotes(session_id)`);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS quote_items (
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
    )
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id)`);

  // ── Auto-cleanup: keep storage lean (runs on every cold start) ──────────────
  // 1. Price history: keep only last 14 days
  sqlite.exec(`DELETE FROM price_history WHERE recorded_at < datetime('now', '-14 days')`);
  // 2. Supplier catalogs: keep only last 3 per supplier (cascade deletes catalog items)
  sqlite.exec(`
    DELETE FROM supplier_catalogs
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY supplier_id ORDER BY imported_at DESC) as rn
        FROM supplier_catalogs
      ) sub WHERE rn <= 3
    )
  `);

  // ── Bootstrap admin from env vars (runs on every cold start, safe to re-run) ─
  // Set INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD + INITIAL_ADMIN_NAME in Railway
  // to automatically create/ensure the admin user exists. Remove the vars once set up.
  const initEmail = process.env.INITIAL_ADMIN_EMAIL?.toLowerCase().trim();
  const initPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();
  const initName = process.env.INITIAL_ADMIN_NAME?.trim() ?? "Admin";
  if (initEmail && initPassword) {
    const existing = sqlite
      .prepare("SELECT id FROM users WHERE LOWER(email) = ?")
      .get(initEmail) as { id: number } | undefined;
    if (!existing) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
      const hash = bcrypt.hashSync(initPassword, 12);
      sqlite
        .prepare("INSERT INTO users (email, password_hash, name, role, is_active) VALUES (?, ?, ?, 'SUPER_ADMIN', 1)")
        .run(initEmail, hash, initName);
      console.log(`[bootstrap] Admin user created: ${initEmail}`);
    }
  }

  _db = drizzle(sqlite, { schema });
  return _db;
}

// $client is present on runtime Drizzle instances but not always in the public type.
type DbInstance = BetterSQLite3Database<typeof schema> & {
  $client: InstanceType<typeof BetterSqlite>;
};

// Proxy that initializes the DB on first method call — never at import time.
// This prevents "no such table" errors during `next build`.
export const db = new Proxy({} as DbInstance, {
  get(_, prop: string | symbol) {
    const instance = getDb() as DbInstance;
    const value = Reflect.get(instance, prop);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    return typeof value === "function" ? (value as Function).bind(instance) : value;
  },
});

export type DB = DbInstance;
