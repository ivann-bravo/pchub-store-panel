/**
 * Setup RAM buscador items: DDR4 + DDR5, Low / Medium / High tiers.
 *
 * Keyword strategy:
 *   filterMustKeywords (AND) = capacity: ["8GB"], ["16GB"], ["32GB"]
 *   filterKeywords     (OR)  = tier markers: ["RGB","Fury"] for High, etc.
 *   filterAttributes         = {memoryType: "DDR4"} or {memoryType: "DDR5"}
 *
 * DDR4 tiers:
 *   Low    → cheapest overall (no extra kw)
 *   Medium → mid-range brands (Patriot, Lexar, Hiksemi, Signature)
 *   High   → gaming/RGB (RGB, Fury, Beast, XPG, Lancer, Gaming)
 *
 * DDR5 tiers (speed-based):
 *   Low    → 4800MHz
 *   Medium → 5600MHz
 *   High   → 6000MHz+ or gaming models (Lancer, XPG, Blade)
 *
 * Usage: node scripts/setup-ram-buscador.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/pchub-demo.db");

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Ensure filter_must_keywords column exists
  const cols = db.prepare("PRAGMA table_info(buscador_items)").all();
  if (!cols.some((c) => c.name === "filter_must_keywords")) {
    db.exec("ALTER TABLE buscador_items ADD COLUMN filter_must_keywords TEXT");
    console.log("Added filter_must_keywords column");
  }

  // ── Step 1: Fix existing Low items ──────────────────────────────────────────
  // Move capacity keyword from filter_keywords → filter_must_keywords
  // so the OR-logic change doesn't affect them
  const existingLowFixes = [
    { id: 19, label: "8GB - Low",  mustKw: ["8GB"],  anyKw: [],       group: "RAM DDR4" },
    { id: 20, label: "16GB - Low", mustKw: ["16GB"], anyKw: [],       group: "RAM DDR4" },
    { id: 21, label: "32GB - Low", mustKw: ["32GB"], anyKw: [],       group: "RAM DDR4" },
    { id: 22, label: "8GB - Low",  mustKw: ["8GB"],  anyKw: ["4800"], group: "RAM DDR5" },
    { id: 23, label: "16GB - Low", mustKw: ["16GB"], anyKw: ["4800"], group: "RAM DDR5" },
    { id: 24, label: "32GB - Low", mustKw: ["32GB"], anyKw: ["4800"], group: "RAM DDR5" },
  ];

  const updateStmt = db.prepare(`
    UPDATE buscador_items
    SET label = ?, filter_must_keywords = ?, filter_keywords = ?, sort_order = ?
    WHERE id = ?
  `);

  console.log("\n── Updating existing Low items ──");
  for (const fix of existingLowFixes) {
    updateStmt.run(
      fix.label,
      JSON.stringify(fix.mustKw),
      fix.anyKw.length > 0 ? JSON.stringify(fix.anyKw) : null,
      1, // sort_order
      fix.id
    );
    console.log(`  Updated id=${fix.id}: [${fix.group}] ${fix.label}`);
  }

  // ── Step 2: Delete any existing Medium/High items (in case script reruns) ──
  // Labels use " - Low" (with spaces), so match with '% - Low%' not '%-Low%'
  db.prepare(`
    DELETE FROM buscador_items
    WHERE group_name IN ('RAM DDR4', 'RAM DDR5')
    AND label NOT LIKE '% - Low%'
  `).run();
  console.log("\nCleared any existing Medium/High items");

  // ── Step 3: Insert new Medium + High items ──────────────────────────────────
  const insertStmt = db.prepare(`
    INSERT INTO buscador_items
      (group_name, label, filter_category, filter_must_keywords, filter_keywords, filter_attributes, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const CATEGORY = "Memorias RAM";

  const newItems = [
    // ── DDR4 Medium ──
    {
      group: "RAM DDR4", label: "8GB - Medium", order: 2,
      mustKw: ["8GB"],
      anyKw:  ["Patriot", "Signature", "Lexar", "Hiksemi", "Hiker", "Corsair"],
      attrs:  { memoryType: "DDR4" },
    },
    {
      group: "RAM DDR4", label: "16GB - Medium", order: 5,
      mustKw: ["16GB"],
      anyKw:  ["Patriot", "Signature", "Lexar", "Hiksemi", "Corsair"],
      attrs:  { memoryType: "DDR4" },
    },
    {
      group: "RAM DDR4", label: "32GB - Medium", order: 8,
      mustKw: ["32GB"],
      anyKw:  ["Lexar", "Patriot", "Signature", "Hiksemi", "Corsair"],
      attrs:  { memoryType: "DDR4" },
    },
    // ── DDR4 High ──
    {
      group: "RAM DDR4", label: "8GB - High", order: 3,
      mustKw: ["8GB"],
      anyKw:  ["RGB", "Fury", "Beast", "XPG", "Lancer", "Gaming"],
      attrs:  { memoryType: "DDR4" },
    },
    {
      group: "RAM DDR4", label: "16GB - High", order: 6,
      mustKw: ["16GB"],
      anyKw:  ["RGB", "Fury", "Beast", "XPG", "Lancer", "Gaming"],
      attrs:  { memoryType: "DDR4" },
    },
    {
      group: "RAM DDR4", label: "32GB - High", order: 9,
      mustKw: ["32GB"],
      anyKw:  ["RGB", "Fury", "Beast", "XPG", "Lancer", "Gaming"],
      attrs:  { memoryType: "DDR4" },
    },
    // ── DDR5 Medium ──
    {
      group: "RAM DDR5", label: "8GB - Medium", order: 2,
      mustKw: ["8GB"],
      anyKw:  ["5600", "KCP"],
      attrs:  { memoryType: "DDR5" },
    },
    {
      group: "RAM DDR5", label: "16GB - Medium", order: 5,
      mustKw: ["16GB"],
      anyKw:  ["5600"],
      attrs:  { memoryType: "DDR5" },
    },
    {
      group: "RAM DDR5", label: "32GB - Medium", order: 8,
      mustKw: ["32GB"],
      anyKw:  ["5600"],
      attrs:  { memoryType: "DDR5" },
    },
    // ── DDR5 High ──
    {
      group: "RAM DDR5", label: "8GB - High", order: 3,
      mustKw: ["8GB"],
      anyKw:  ["6000", "6200", "6400", "Lancer", "XPG", "Blade"],
      attrs:  { memoryType: "DDR5" },
    },
    {
      group: "RAM DDR5", label: "16GB - High", order: 6,
      mustKw: ["16GB"],
      anyKw:  ["6000", "6200", "Lancer", "XPG", "Blade"],
      attrs:  { memoryType: "DDR5" },
    },
    {
      group: "RAM DDR5", label: "32GB - High", order: 9,
      mustKw: ["32GB"],
      anyKw:  ["6000", "6200", "Lancer", "XPG", "Blade"],
      attrs:  { memoryType: "DDR5" },
    },
  ];

  console.log("\n── Inserting new Medium/High items ──");
  const doInsert = db.transaction(() => {
    for (const item of newItems) {
      insertStmt.run(
        item.group,
        item.label,
        CATEGORY,
        JSON.stringify(item.mustKw),
        item.anyKw.length > 0 ? JSON.stringify(item.anyKw) : null,
        JSON.stringify(item.attrs),
        item.order
      );
      const mustDesc = item.mustKw.join(", ");
      const anyDesc = item.anyKw.length > 0 ? ` | OR: ${item.anyKw.join(", ")}` : "";
      console.log(`  [${item.group}] ${item.label}: AND=[${mustDesc}]${anyDesc}`);
    }
  });
  doInsert();

  // ── Fix sort_order for existing Low items (keep them sorted 1/4/7) ──
  const lowOrders = [
    { id: 19, order: 1 }, // 8GB Low DDR4
    { id: 20, order: 4 }, // 16GB Low DDR4
    { id: 21, order: 7 }, // 32GB Low DDR4
    { id: 22, order: 1 }, // 8GB Low DDR5
    { id: 23, order: 4 }, // 16GB Low DDR5
    { id: 24, order: 7 }, // 32GB Low DDR5
  ];
  const orderStmt = db.prepare("UPDATE buscador_items SET sort_order = ? WHERE id = ?");
  for (const { id, order } of lowOrders) {
    orderStmt.run(order, id);
  }

  // ── Verify ──────────────────────────────────────────────────────────────────
  const allRam = db.prepare(`
    SELECT group_name, label, filter_must_keywords, filter_keywords, filter_attributes
    FROM buscador_items
    WHERE group_name IN ('RAM DDR4','RAM DDR5')
    ORDER BY group_name, sort_order, id
  `).all();

  console.log("\n── Final state ──");
  let lastGroup = "";
  for (const r of allRam) {
    if (r.group_name !== lastGroup) {
      console.log(`\n  ${r.group_name}`);
      lastGroup = r.group_name;
    }
    const mustKw = r.filter_must_keywords ? JSON.parse(r.filter_must_keywords) : [];
    const anyKw  = r.filter_keywords      ? JSON.parse(r.filter_keywords)      : [];
    const attrs  = r.filter_attributes    ? JSON.parse(r.filter_attributes)    : {};
    const attrStr = Object.entries(attrs).map(([k,v]) => `${k}=${v}`).join(", ");
    console.log(`    ${r.label.padEnd(16)} AND=[${mustKw.join(",")}]  OR=[${anyKw.join(",")}]  attrs={${attrStr}}`);
  }

  console.log(`\nTotal RAM items: ${allRam.length}`);
  db.close();
}

main();
