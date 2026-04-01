/**
 * One-shot migration: extract DDR4/DDR5 keywords from combo_slots.filter_keywords
 * into the new filter_attributes column, keeping the keyword list clean.
 *
 * Usage: node scripts/migrate-slot-attributes.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = path.join(__dirname, "../data/pchub-demo.db");

// Maps keyword patterns to memoryType attribute value
const MEMORY_KEYWORD_MAP = {
  DDR4: "DDR4",
  D4:   "DDR4",
  DDR5: "DDR5",
  D5:   "DDR5",
};

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  const slots = db
    .prepare(
      `SELECT id, filter_keywords, filter_attributes FROM combo_slots WHERE slot_type = 'auto'`
    )
    .all();

  console.log(`Found ${slots.length} auto slots to process`);

  const updateStmt = db.prepare(
    `UPDATE combo_slots SET filter_keywords = ?, filter_attributes = ? WHERE id = ?`
  );

  let migrated = 0;
  let skipped = 0;

  const doMigrate = db.transaction(() => {
    for (const slot of slots) {
      if (!slot.filter_keywords) { skipped++; continue; }

      let keywords;
      try {
        keywords = JSON.parse(slot.filter_keywords);
      } catch {
        skipped++;
        continue;
      }

      if (!Array.isArray(keywords)) { skipped++; continue; }

      // Find memory type keyword
      let detectedMemoryType = null;
      const remainingKeywords = [];

      for (const kw of keywords) {
        const kwUpper = kw.trim().toUpperCase();
        if (MEMORY_KEYWORD_MAP[kwUpper]) {
          detectedMemoryType = MEMORY_KEYWORD_MAP[kwUpper];
          // Don't add to remaining (removed from keywords)
        } else {
          remainingKeywords.push(kw);
        }
      }

      if (!detectedMemoryType) { skipped++; continue; }

      // Merge with existing filter_attributes if any
      let existingAttrs = {};
      if (slot.filter_attributes) {
        try { existingAttrs = JSON.parse(slot.filter_attributes); } catch {}
      }

      const newAttrs = { ...existingAttrs, memoryType: detectedMemoryType };
      const newKeywords = remainingKeywords.length > 0 ? remainingKeywords : null;

      updateStmt.run(
        newKeywords ? JSON.stringify(newKeywords) : null,
        JSON.stringify(newAttrs),
        slot.id
      );
      migrated++;

      console.log(
        `  Slot #${slot.id}: removed [${detectedMemoryType}] keyword, set filterAttributes.memoryType="${detectedMemoryType}"`
      );
    }
  });

  doMigrate();

  console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);

  db.close();
}

main();
