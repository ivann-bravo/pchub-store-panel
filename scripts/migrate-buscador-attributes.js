/**
 * One-shot migration: extract DDR4/DDR5/socket keywords from buscador_items.filter_keywords
 * into the new filter_attributes column.
 *
 * También actualiza los labels para que reflejen solo el contenido sin redundancias.
 *
 * Usage: node scripts/migrate-buscador-attributes.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/pchub-demo.db");

const MEMORY_KEYWORD_MAP = {
  DDR4: "DDR4",
  D4:   "DDR4",
  DDR5: "DDR5",
  D5:   "DDR5",
  DDR3: "DDR3",
  D3:   "DDR3",
};

// Socket keywords: if a keyword is purely a socket number/name, extract it
// (won't touch chipset keywords like "H610", "B660", etc.)
const SOCKET_KEYWORD_MAP = {
  AM4:  "AM4",
  AM5:  "AM5",
  "1151": "1151",
  "1200": "1200",
  "1700": "1700",
  "1851": "1851",
};

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Apply migration if column doesn't exist yet
  const cols = db.prepare("PRAGMA table_info(buscador_items)").all();
  const hasCol = cols.some((c) => c.name === "filter_attributes");
  if (!hasCol) {
    db.exec("ALTER TABLE buscador_items ADD COLUMN filter_attributes TEXT");
    console.log("Added filter_attributes column to buscador_items");
  }

  const items = db.prepare("SELECT id, label, group_name, filter_keywords, filter_attributes FROM buscador_items").all();
  console.log(`Found ${items.length} buscador items to process`);

  const updateStmt = db.prepare(
    `UPDATE buscador_items SET filter_keywords = ?, filter_attributes = ? WHERE id = ?`
  );

  let migrated = 0;
  let skipped = 0;

  const doMigrate = db.transaction(() => {
    for (const item of items) {
      if (!item.filter_keywords) { skipped++; continue; }

      let keywords;
      try {
        keywords = JSON.parse(item.filter_keywords);
      } catch {
        skipped++;
        continue;
      }

      if (!Array.isArray(keywords) || keywords.length === 0) { skipped++; continue; }

      let detectedMemoryType = null;
      let detectedSocket = null;
      const remainingKeywords = [];

      for (const kw of keywords) {
        const kwUpper = kw.trim().toUpperCase();
        if (MEMORY_KEYWORD_MAP[kwUpper]) {
          detectedMemoryType = MEMORY_KEYWORD_MAP[kwUpper];
          // Remove from keywords
        } else if (SOCKET_KEYWORD_MAP[kwUpper]) {
          detectedSocket = SOCKET_KEYWORD_MAP[kwUpper];
          // Remove from keywords — socket is now in filterAttributes
        } else {
          remainingKeywords.push(kw);
        }
      }

      if (!detectedMemoryType && !detectedSocket) { skipped++; continue; }

      // Merge with existing filter_attributes if any
      let existingAttrs = {};
      if (item.filter_attributes) {
        try { existingAttrs = JSON.parse(item.filter_attributes); } catch {}
      }

      const newAttrs = { ...existingAttrs };
      if (detectedMemoryType) newAttrs.memoryType = detectedMemoryType;
      if (detectedSocket) newAttrs.socket = detectedSocket;

      const newKeywords = remainingKeywords.length > 0 ? remainingKeywords : null;

      updateStmt.run(
        newKeywords ? JSON.stringify(newKeywords) : null,
        JSON.stringify(newAttrs),
        item.id
      );
      migrated++;

      const attrDesc = Object.entries(newAttrs).map(([k,v]) => `${k}=${v}`).join(", ");
      console.log(
        `  [${item.group_name}] "${item.label}": keywords=[${remainingKeywords.join(",")}] attrs={${attrDesc}}`
      );
    }
  });

  doMigrate();

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);

  // Verification
  const sample = db.prepare(
    `SELECT group_name, label, filter_keywords, filter_attributes FROM buscador_items WHERE filter_attributes IS NOT NULL LIMIT 8`
  ).all();
  console.log("\nSample after migration:");
  for (const r of sample) {
    console.log(`  [${r.group_name}] "${r.label}"`);
    console.log(`    keywords: ${r.filter_keywords}`);
    console.log(`    attrs:    ${r.filter_attributes}`);
  }

  db.close();
}

main();
