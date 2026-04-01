import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { parseArgNumber } from "../number-format";
import fs from "fs";
import path from "path";

const SUPPLIER_DEFS = [
  { code: "NB", name: "NB", currency: "ARS" as const },
  { code: "AIR", name: "AIR", currency: "USD" as const },
  { code: "GN", name: "GN", currency: "ARS" as const },
  { code: "ELIT", name: "ELIT", currency: "ARS" as const },
  { code: "Invid", name: "Invid", currency: "ARS" as const },
  { code: "HDC", name: "HDC", currency: "ARS" as const },
  { code: "Sentey", name: "Sentey", currency: "ARS" as const },
  { code: "Try", name: "Try", currency: "ARS" as const },
  { code: "Intermaco", name: "Intermaco", currency: "ARS" as const },
  { code: "Ashir", name: "Ashir", currency: "ARS" as const },
  { code: "PC Arts", name: "PC Arts", currency: "ARS" as const },
  { code: "Polytech", name: "Polytech", currency: "ARS" as const },
  { code: "Latamly", name: "Latamly", currency: "ARS" as const },
];

// Column name in CSV → supplier code
const SUPPLIER_CODE_COLS: Record<string, string> = {
  "Cod NB": "NB",
  "Cod AIR": "AIR",
  "Cod GN": "GN",
  "Cod ELIT": "ELIT",
  "Cod Invid": "Invid",
  "Cod HDC": "HDC",
  "Cod Sentey": "Sentey",
  "Cod Try": "Try",
  "Cod Intermaco": "Intermaco",
  "Cod Ashir": "Ashir",
  "Cod PC Arts": "PC Arts",
  "Cod Polytech": "Polytech",
  "Cod Latamly": "Latamly",
};

const SUPPLIER_PRICE_COLS: Record<string, string> = {
  "Precio NB": "NB",
  "Precio AIR": "AIR",
  "Precio GN": "GN",
  "Precio Elit": "ELIT",
  "Precio Invid": "Invid",
  "Precio HDC": "HDC",
  "Precio Sentey": "Sentey",
  "Precio Try": "Try",
  "Precio Intermaco": "Intermaco",
  "Precio Ashir": "Ashir",
  "Precio PC Arts": "PC Arts",
  "Precio Polytech": "Polytech",
};

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function seed() {
  console.log("Starting seed...");

  const dbDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, "pchub-demo.db");
  // Remove old DB if exists
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
    console.log("Removed old database");
  }

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });

  // Create tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'ARS',
      tax_rate REAL NOT NULL DEFAULT 0,
      shipping_surcharge REAL NOT NULL DEFAULT 0,
      shipping_percent REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      column_mapping TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      woocommerce_id INTEGER,
      name TEXT NOT NULL,
      sku TEXT,
      ean_upc TEXT,
      category TEXT,
      brand TEXT,
      warranty TEXT,
      iva_rate REAL NOT NULL DEFAULT 0.21,
      markup_regular REAL NOT NULL DEFAULT 1.0,
      markup_offer REAL,
      offer_start TEXT,
      offer_end TEXT,
      local_stock INTEGER NOT NULL DEFAULT 0,
      has_supplier_stock INTEGER NOT NULL DEFAULT 0,
      weight_kg REAL,
      length_cm REAL,
      width_cm REAL,
      height_cm REAL,
      image_url TEXT,
      slug TEXT,
      store_url TEXT,
      product_tags TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS product_supplier_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      supplier_code TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(product_id, supplier_id)
    );

    CREATE TABLE IF NOT EXISTS supplier_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_id INTEGER NOT NULL REFERENCES product_supplier_links(id) ON DELETE CASCADE,
      raw_price REAL NOT NULL,
      currency TEXT NOT NULL,
      exchange_rate REAL,
      final_cost_ars REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS supplier_catalogs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      linked_count INTEGER NOT NULL DEFAULT 0,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS supplier_catalog_items (
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

    CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'oficial',
      buy_rate REAL NOT NULL,
      sell_rate REAL NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  console.log("Tables created");

  // Insert suppliers
  const supplierMap = new Map<string, number>();
  for (const s of SUPPLIER_DEFS) {
    const result = db.insert(schema.suppliers).values({
      code: s.code,
      name: s.name,
      currency: s.currency,
    }).returning().get();
    supplierMap.set(s.code, result.id);
  }
  console.log(`Inserted ${supplierMap.size} suppliers`);

  // Read and parse CSV
  const csvPath = path.join(process.cwd(), "MASTER.csv");
  const csvContent = fs.readFileSync(csvPath, "utf-8");
  const lines = csvContent.split("\n").filter((l) => l.trim());
  const headers = parseCSVLine(lines[0]);

  console.log(`CSV has ${lines.length - 1} data rows, ${headers.length} columns`);

  // Build column index map
  const colIdx = new Map<string, number>();
  headers.forEach((h, i) => colIdx.set(h.trim(), i));

  // Batch insert using transactions
  let productCount = 0;
  let linkCount = 0;
  let priceCount = 0;
  let verifyErrors = 0;

  const insertProduct = sqlite.prepare(`
    INSERT INTO products (woocommerce_id, name, sku, ean_upc, category, brand, warranty,
      iva_rate, markup_regular, markup_offer, offer_start, offer_end, local_stock,
      has_supplier_stock, weight_kg, length_cm, width_cm, height_cm,
      image_url, slug, store_url, product_tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLink = sqlite.prepare(`
    INSERT INTO product_supplier_links (product_id, supplier_id, supplier_code)
    VALUES (?, ?, ?)
  `);

  const insertPrice = sqlite.prepare(`
    INSERT INTO supplier_prices (link_id, raw_price, currency, final_cost_ars)
    VALUES (?, ?, ?, ?)
  `);

  const transaction = sqlite.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVLine(lines[i]);
      if (fields.length < 10) continue;

      const get = (col: string) => {
        const idx = colIdx.get(col);
        return idx !== undefined ? fields[idx]?.trim() || null : null;
      };

      const wooId = get("ID Woocommerce");
      const name = get("Nombre");
      if (!name) continue;

      const ivaRate = parseArgNumber(get("IVA")) ?? 0.21;
      const markupRegular = parseArgNumber(get("Markup Regular")) ?? 1.0;
      const markupOffer = parseArgNumber(get("Markup Oferta"));
      const localStock = parseInt(get("Stock Fisico Local") || "0") || 0;
      const hasSupplierStock = get("Tiene Stock Proveedor?") === "SI";

      const result = insertProduct.run(
        wooId ? parseInt(wooId) : null,
        name,
        get("SKU"),
        get("EAN / UPC"),
        get("Categorías"),
        get("Marca"),
        get("Garantía"),
        ivaRate,
        markupRegular,
        markupOffer,
        get("Inicio Oferta"),
        get("Fin Oferta"),
        localStock,
        hasSupplierStock ? 1 : 0,
        parseFloat(get("Peso (kg)") || "") || null,
        parseFloat(get("Longitud (cm)") || "") || null,
        parseFloat(get("Ancho (cm)") || "") || null,
        parseFloat(get("Altura (cm)") || "") || null,
        get("url_image"),
        get("slug"),
        get("URL a tienda online"),
        get("tax:product_tag")
      );

      const productId = Number(result.lastInsertRowid);
      productCount++;

      // Create links and prices for each supplier
      for (const [codCol, supplierCode] of Object.entries(SUPPLIER_CODE_COLS)) {
        const code = get(codCol);
        if (!code) continue;

        const supplierId = supplierMap.get(supplierCode);
        if (!supplierId) continue;

        const linkResult = insertLink.run(productId, supplierId, code);
        const linkId = Number(linkResult.lastInsertRowid);
        linkCount++;

        // Find price column
        const priceColName = Object.keys(SUPPLIER_PRICE_COLS).find(
          (k) => SUPPLIER_PRICE_COLS[k] === supplierCode
        );
        if (priceColName) {
          const rawPrice = parseArgNumber(get(priceColName));
          if (rawPrice && rawPrice > 0) {
            const supplierDef = SUPPLIER_DEFS.find((s) => s.code === supplierCode);
            const currency = supplierDef?.currency || "ARS";
            // For seed, final_cost_ars = raw_price (no tax adjustments yet)
            insertPrice.run(linkId, rawPrice, currency, rawPrice);
            priceCount++;
          }
        }
      }

      // Verify: compare calculated "Menor Precio Proveedor" with CSV value
      const csvMinPrice = parseArgNumber(get("Menor Precio Proveedor"));
      if (csvMinPrice && csvMinPrice > 0) {
        // Get the min price from what we just inserted for this product
        const minPriceRow = sqlite.prepare(`
          SELECT MIN(sp.raw_price) as min_price
          FROM supplier_prices sp
          JOIN product_supplier_links psl ON sp.link_id = psl.id
          WHERE psl.product_id = ?
        `).get(productId) as { min_price: number | null } | undefined;

        if (minPriceRow?.min_price) {
          const diff = Math.abs(minPriceRow.min_price - csvMinPrice);
          if (diff > 0.02) {
            verifyErrors++;
            if (verifyErrors <= 5) {
              console.log(`  Verify mismatch row ${i}: calc=${minPriceRow.min_price} csv=${csvMinPrice} diff=${diff.toFixed(2)} product="${name}"`);
            }
          }
        }
      }

      if (productCount % 2000 === 0) {
        console.log(`  Processed ${productCount} products...`);
      }
    }
  });

  transaction();

  // Create indexes for performance
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
    CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_links_product ON product_supplier_links(product_id);
    CREATE INDEX IF NOT EXISTS idx_links_supplier ON product_supplier_links(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_prices_link ON supplier_prices(link_id);
    CREATE INDEX IF NOT EXISTS idx_catalog_items_catalog ON supplier_catalog_items(catalog_id);
  `);

  // Insert a default exchange rate
  db.insert(schema.exchangeRates).values({
    source: "oficial",
    buyRate: 1050.0,
    sellRate: 1090.0,
  }).run();

  console.log("\n=== Seed Complete ===");
  console.log(`Products: ${productCount}`);
  console.log(`Links: ${linkCount}`);
  console.log(`Prices: ${priceCount}`);
  console.log(`Verify mismatches: ${verifyErrors}`);

  // Stats
  const stats = sqlite.prepare(`
    SELECT
      (SELECT COUNT(*) FROM products) as total_products,
      (SELECT COUNT(*) FROM suppliers) as total_suppliers,
      (SELECT COUNT(*) FROM product_supplier_links) as total_links,
      (SELECT COUNT(*) FROM supplier_prices) as total_prices,
      (SELECT COUNT(DISTINCT category) FROM products WHERE category IS NOT NULL) as categories,
      (SELECT COUNT(DISTINCT brand) FROM products WHERE brand IS NOT NULL) as brands
  `).get() as Record<string, number>;
  console.log("\nDatabase stats:", stats);

  sqlite.close();
}

seed().catch(console.error);
