/**
 * sync-combo-stock.cjs
 *
 * Fixes stock sync mismatches: combos where last_has_stock != product.has_supplier_stock.
 * Applies the same fix as the corrected refreshCombo logic:
 * - Updates product has_supplier_stock whenever it differs from combo last_has_stock
 * - Also updates price if it differs
 *
 * Run: node scripts/sync-combo-stock.cjs
 */
const Database = require('better-sqlite3');
const db = new Database('./data/pchub-demo.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Find all mismatches: combo says one thing, product says another
const mismatches = db.prepare(`
  SELECT ct.id as combo_id, ct.sku, ct.last_has_stock as combo_stock,
         ct.last_total_price as combo_price,
         p.id as product_id, p.has_supplier_stock as prod_stock,
         p.own_price_regular as prod_price
  FROM combo_templates ct
  JOIN products p ON p.id = ct.product_id
  WHERE ct.sku LIKE 'PCTRY%'
    AND (ct.last_has_stock != p.has_supplier_stock
         OR (ct.last_total_price IS NOT NULL AND ct.last_total_price != COALESCE(p.own_price_regular, -1))
         OR (ct.last_total_price IS NULL AND p.own_price_regular IS NOT NULL)
    )
`).all();

console.log('Found ' + mismatches.length + ' mismatched combos to sync');

const updateProduct = db.prepare(`
  UPDATE products
  SET has_supplier_stock = ?,
      own_price_regular = ?,
      updated_at = datetime('now')
  WHERE id = ?
`);

const insertPriceHistory = db.prepare(`
  INSERT INTO product_price_history (product_id, price_regular, price_offer)
  VALUES (?, ?, NULL)
`);

const syncAll = db.transaction(() => {
  let fixed = 0;
  for (const m of mismatches) {
    const comboStock = m.combo_stock ? 1 : 0;
    updateProduct.run(comboStock, m.combo_price, m.product_id);

    // Record price history only if price actually changed
    if (m.combo_price !== null && m.combo_price !== m.prod_price) {
      insertPriceHistory.run(m.product_id, m.combo_price);
    }

    console.log('  Fixed ' + m.sku + ': stock ' + m.prod_stock + '->' + comboStock +
      (m.combo_price !== m.prod_price ? ' price ' + (m.prod_price || 'NULL') + '->' + (m.combo_price ? m.combo_price.toFixed(0) : 'NULL') : ''));
    fixed++;
  }
  return fixed;
});

const fixed = syncAll();
console.log('\nDone. Fixed ' + fixed + ' combos.');

// Final verification
const remaining = db.prepare(`
  SELECT COUNT(*) as cnt
  FROM combo_templates ct
  JOIN products p ON p.id = ct.product_id
  WHERE ct.sku LIKE 'PCTRY%'
    AND ct.last_has_stock != p.has_supplier_stock
`).get();
console.log('Remaining stock mismatches: ' + remaining.cnt);

db.close();
