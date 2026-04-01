/**
 * seed-combos.js
 *
 * Imports all combo templates from references/Armador.xlsx into the database.
 *
 * Usage:
 *   node scripts/seed-combos.js [--dry-run] [--clear]
 *
 * --dry-run  Parse and report without writing to DB
 * --clear    Delete all existing combos before importing
 */

"use strict";

const Database = require("better-sqlite3");
const XLSX = require("xlsx");
const path = require("path");

const DRY_RUN = process.argv.includes("--dry-run");
const CLEAR = process.argv.includes("--clear");

// ─── DB setup ─────────────────────────────────────────────────────────────────

const dbPath = path.join(__dirname, "..", "data", "pchub-demo.db");
const xlsxPath = path.join(__dirname, "..", "references", "Armador.xlsx");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Category mapping (from actual DB categories) ──────────────────────────────

const CAT = {
  motherAmd: "Mothers AMD",
  motherIntel: "Mothers INTEL",
  ram: "Memorias RAM",
  ssd: "Discos Sólidos SSD",
  cooler: "Coolers CPU",
  gpuNvidia: "GPUs NVIDIA",
  gpuAmd: "GPUs AMD",
  gabinete: "Gabinetes",
  fuente: "Fuentes",
  procesador: "Procesadores",
};

// Mother keyword map: socket-TIER → [keywords]
const MOTHER_KW = {
  "AM4-LOW":    ["AM4", "A520"],
  "AM4-MEDIUM": ["AM4", "B550"],
  "AM4-HIGH":   ["AM4", "X570"],
  "AM5-LOW":    ["AM5", "A620"],
  "AM5-MEDIUM": ["AM5", "B650"],
  "AM5-HIGH":   ["AM5", "X670"],
  "1200-LOW":    ["1200", "H510"],
  "1200-MEDIUM": ["1200", "B560"],
  "1200-HIGH":   ["1200", "Z590"],
  "1700-LOW":    ["1700", "H610"],
  "1700-MEDIUM": ["1700", "B660"],
  "1700-HIGH":   ["1700", "Z690"],
  "1851-LOW":    ["1851", "H810"],
  "1851-MEDIUM": ["1851", "B860"],
  "1851-HIGH":   ["1851", "Z890"],
};

// ─── Helper: parse a basic combo SKU ──────────────────────────────────────────
//
// Format: C-{SOCKET}-{RAM_GB}{DDR_SUFFIX}-[{SSD_SIZE}-]{TIER}
// Examples:
//   C-AM4-8D4-LOW         → { socket:'AM4', ramGb:'8', ramType:'DDR4', ssd:null, tier:'LOW' }
//   C-1200-8D4-120-LOW    → { socket:'1200', ramGb:'8', ramType:'DDR4', ssd:'120GB', tier:'LOW' }
//   C-AM5-32D5-2T-HIGH    → { socket:'AM5', ramGb:'32', ramType:'DDR5', ssd:'2TB', tier:'HIGH' }

function parseBasicComboSku(sku) {
  const raw = sku.slice(2); // remove 'C-'
  const parts = raw.split("-");

  const socket = parts[0]; // AM4, AM5, 1200, 1700, 1851

  const ramPart = parts[1]; // 8D4, 16D5, etc.
  const ramMatch = ramPart ? ramPart.match(/^(\d+)(D[45])$/) : null;
  const ramGb = ramMatch ? ramMatch[1] : "8";
  const ramType = ramMatch ? (ramMatch[2] === "D5" ? "DDR5" : "DDR4") : "DDR4";

  let ssd = null;
  let tier = "LOW";

  for (let i = 2; i < parts.length; i++) {
    const p = parts[i];
    if (p === "LOW" || p === "MEDIUM" || p === "HIGH") {
      tier = p;
    } else if (/^\d{3,}$/.test(p)) {
      // SSD size in GB: 120, 240, 500
      ssd = p + "GB";
    } else if (p === "1T") {
      ssd = "1TB";
    } else if (p === "2T") {
      ssd = "2TB";
    }
    // COOLER not present in current SKUs
  }

  return { socket, ramGb, ramType, ssd, tier };
}

// ─── Build slots for a basic combo from its parsed SKU ──────────────────────

function buildBasicComboSlots(parsed) {
  const slots = [];
  let order = 1;

  // MOTHER
  const motherKey = `${parsed.socket}-${parsed.tier}`;
  const motherKw = MOTHER_KW[motherKey] || [parsed.socket];
  const motherCat = parsed.socket === "AM4" || parsed.socket === "AM5"
    ? CAT.motherAmd
    : CAT.motherIntel;

  // For 1700 socket, add DDR type to narrow down (DDR4 vs DDR5 boards)
  const motherKwFull = [...motherKw];
  if (parsed.socket === "1700" || parsed.socket === "1851") {
    motherKwFull.push(parsed.ramType);
  }

  slots.push({
    slotName: "Mother",
    slotType: "auto",
    filterCategory: motherCat,
    filterKeywords: JSON.stringify(motherKwFull),
    sortOrder: order++,
  });

  // RAM
  slots.push({
    slotName: `RAM ${parsed.ramGb}GB ${parsed.ramType}`,
    slotType: "auto",
    filterCategory: CAT.ram,
    filterKeywords: JSON.stringify([`${parsed.ramGb}GB`, parsed.ramType]),
    sortOrder: order++,
  });

  // SSD (optional)
  if (parsed.ssd) {
    slots.push({
      slotName: `SSD ${parsed.ssd}`,
      slotType: "auto",
      filterCategory: CAT.ssd,
      filterKeywords: JSON.stringify([parsed.ssd]),
      sortOrder: order++,
    });
  }

  return slots;
}

// ─── GPU label → auto slot definition ──────────────────────────────────────

function gpuLabelToSlot(label) {
  const clean = label.trim();
  const isNvidia = /RTX|GTX|4060|3060|3050/i.test(clean);
  const cat = isNvidia ? CAT.gpuNvidia : CAT.gpuAmd;

  // Extract meaningful keywords: model + VRAM
  // e.g. "RX 6600 8GB" → ["RX 6600", "8GB"]
  // e.g. "RTX 3060 12GB" → ["RTX 3060", "12GB"]
  const vramMatch = clean.match(/\d+GB/);
  const vram = vramMatch ? vramMatch[0] : null;

  // Model: everything before the VRAM part
  const modelPart = vram ? clean.replace(vram, "").trim().replace(/\s+/, " ") : clean;

  const keywords = [modelPart];
  if (vram) keywords.push(vram);

  return { slotType: "auto", filterCategory: cat, filterKeywords: JSON.stringify(keywords) };
}

// ─── Service product IDs (resolved from DB) ─────────────────────────────────

const SERVICE_IDS = {
  "Service Basico":   11903, // "Armado de PC Basico - PC Oficina"
  "Service Complejo": 11904, // "Armado de PC Complejo - PC Gamer - Varios componentes"
};

// ─── PC slot definition builder ─────────────────────────────────────────────
// Returns { slotType, fixedProductId?, fixedComboId?, filterCategory?, filterKeywords? }

function buildPcSlotDef(slotType, slotId, slotName, comboSkuToId) {
  switch (slotType) {
    case "CPU":
    case "FUENTE": {
      // FUENTE can also be "Kit Oficina" (string) — handle below
      if (!isNaN(Number(slotId)) && Number(slotId) > 0) {
        // Excel IDs are WooCommerce IDs — look up the internal DB ID
        const row = findProductByWooIdStmt.get(Number(slotId));
        if (!row) {
          console.warn(`  ⚠ WooCommerce product ${slotId} not found in DB (slot: ${slotType})`);
          return null;
        }
        return { slotType: "fixed", fixedProductId: row.id };
      }
      // "Fuente 500w 80+", "Fuente 650w 80+"
      if (String(slotId).startsWith("Fuente")) {
        const wMatch = String(slotId).match(/(\d+)[wW]/);
        const kw = wMatch ? [`${wMatch[1]}W`, "80"] : ["Fuente"];
        return { slotType: "auto", filterCategory: CAT.fuente, filterKeywords: JSON.stringify(kw) };
      }
      // "Kit Oficina" as FUENTE
      if (String(slotId).includes("Kit")) {
        return {
          slotType: "auto",
          filterCategory: CAT.gabinete,
          filterKeywords: JSON.stringify(["Kit", "Teclado"]),
        };
      }
      return null;
    }

    case "COMBO": {
      const comboId = comboSkuToId[String(slotId)];
      if (comboId) return { slotType: "combo", fixedComboId: comboId };
      // Fallback: some PCs have COMBO slots with a MOTHER label like "AM5 - Low"
      if (String(slotId).includes(" - ")) {
        return buildPcSlotDef("MOTHER", slotId, slotName, comboSkuToId);
      }
      console.warn(`  ⚠ Combo SKU not found: ${slotId}`);
      return null;
    }

    case "MOTHER": {
      // Label: "AM4 - Low", "AM5 - Low"
      const parts = String(slotId).split(" - ");
      const socket = parts[0].trim();
      const tierRaw = (parts[1] || "Low").trim();
      const tier = tierRaw.toUpperCase();
      const kw = MOTHER_KW[`${socket}-${tier}`] || [socket];
      const cat = socket === "AM4" || socket === "AM5" ? CAT.motherAmd : CAT.motherIntel;
      return { slotType: "auto", filterCategory: cat, filterKeywords: JSON.stringify(kw) };
    }

    case "GPU": {
      return gpuLabelToSlot(String(slotId));
    }

    case "GABINETE": {
      // "Gamer - Low" or "Gamer - Medium"
      const kw = ["Gamer"];
      return { slotType: "auto", filterCategory: CAT.gabinete, filterKeywords: JSON.stringify(kw) };
    }

    case "Kit Oficina": {
      return {
        slotType: "auto",
        filterCategory: CAT.gabinete,
        filterKeywords: JSON.stringify(["Kit", "Teclado"]),
      };
    }

    case "Servicio": {
      const productId = SERVICE_IDS[String(slotId)];
      if (productId) return { slotType: "fixed", fixedProductId: productId };
      // Fallback: try to find by name in DB
      const row = db.prepare("SELECT id FROM products WHERE name LIKE ? LIMIT 1").get(`%${slotId}%`);
      if (row) return { slotType: "fixed", fixedProductId: row.id };
      console.warn(`  ⚠ Servicio product not found: ${slotId}`);
      return null;
    }

    default:
      return null;
  }
}

// ─── Parse Excel ─────────────────────────────────────────────────────────────

console.log("Reading Excel:", xlsxPath);
const wb = XLSX.readFile(xlsxPath);

// Sheet 2: Buscador y Combos Básicos — right columns G-K are basic combos
const ws2 = wb.Sheets["Buscador y Combos Básicos"];
const sheet2 = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: "" });

const basicCombos = [];
for (const row of sheet2) {
  const sku = String(row[6] || "").trim();
  const name = String(row[7] || "").trim();
  if (sku.startsWith("C-") && name) {
    basicCombos.push({ sku, name });
  }
}
console.log(`Parsed ${basicCombos.length} basic combos (C-xxx)`);

// Sheet 3: Combos Y PCs Armadas — full PC builds
const ws3 = wb.Sheets["Combos Y PCs Armadas"];
const sheet3 = XLSX.utils.sheet_to_json(ws3, { header: 1, defval: "" });

// Parse PC blocks. Each block:
//   header row: ["Componente", "", "x", "Artículo", "PV Try contado", "stock?", PCTRY_NUM, "Obs"]
//   component rows: [type, id, qty, name, price, stock, ...]
//   total row: ["TOTAL", "", "", pc_name, total_price, stock_status, PCTRY_SKU, description]

const pcBuilds = [];
let currentSlots = [];
let currentPctryNum = null;

for (let i = 0; i < sheet3.length; i++) {
  const row = sheet3[i];
  const col0 = String(row[0] || "").trim();
  const col6 = String(row[6] || "").trim();

  if (col0 === "Componente" && /^\d{4}$/.test(col6)) {
    // Start of a new PC block
    currentPctryNum = col6;
    currentSlots = [];
  } else if (col0 === "TOTAL" && col6.startsWith("PCTRY")) {
    // End of current PC block
    const pcSku = col6;
    const pcName = String(row[3] || "").trim();
    const pcDesc = String(row[7] || "").trim();
    pcBuilds.push({ sku: pcSku, name: pcName, notes: pcDesc, slots: currentSlots });
    currentSlots = [];
    currentPctryNum = null;
  } else if (currentPctryNum !== null && col0 && col0 !== "TOTAL") {
    // Component row
    const slotType = col0;
    const slotId = String(row[1] || "").trim();
    const qty = Number(row[2]) || 1;
    const slotName = String(row[3] || "").trim();
    currentSlots.push({ slotType, slotId, qty, slotName });
  }
}
console.log(`Parsed ${pcBuilds.length} PC builds (PCTRY####)`);

// ─── DB operations ───────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log("\n[DRY RUN] Would create:");
  console.log(`  ${basicCombos.length} basic combo templates`);
  console.log(`  ${pcBuilds.length} PC build templates`);
  basicCombos.slice(0, 5).forEach((c) => {
    const parsed = parseBasicComboSku(c.sku);
    const slots = buildBasicComboSlots(parsed);
    console.log(`  ${c.sku} → ${slots.length} slots`);
  });
  process.exit(0);
}

if (CLEAR) {
  console.log("\nClearing existing combo templates...");
  db.prepare("DELETE FROM combo_templates").run();
  console.log("Done.");
}

// ─── Prepared statements ─────────────────────────────────────────────────────

const insertTemplate = db.prepare(`
  INSERT OR IGNORE INTO combo_templates (name, sku, product_id, is_active, notes)
  VALUES (?, ?, ?, 1, ?)
`);

const insertSlot = db.prepare(`
  INSERT INTO combo_slots (template_id, slot_name, sort_order, slot_type, quantity, fixed_product_id, fixed_combo_id, filter_category, filter_keywords)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const findTemplateBySkuStmt     = db.prepare("SELECT id FROM combo_templates WHERE sku = ?");
const findProductBySkuStmt       = db.prepare("SELECT id FROM products WHERE sku = ? LIMIT 1");
// Excel product IDs are WooCommerce IDs, not internal DB IDs
const findProductByWooIdStmt    = db.prepare("SELECT id FROM products WHERE woocommerce_id = ? LIMIT 1");

// ─── Phase 1: Import basic combos ────────────────────────────────────────────

console.log("\n── Phase 1: Importing basic combos ──────────────────────────");

let basicOk = 0, basicSkipped = 0;
const comboSkuToId = {}; // sku → combo_templates.id

const importBasicCombos = db.transaction(() => {
  for (const combo of basicCombos) {
    let parsed;
    try {
      parsed = parseBasicComboSku(combo.sku);
    } catch (err) {
      console.warn(`  ⚠ Cannot parse SKU ${combo.sku}: ${err.message}`);
      basicSkipped++;
      continue;
    }

    const slots = buildBasicComboSlots(parsed);

    const result = insertTemplate.run(combo.name, combo.sku, null, null);
    let templateId;

    if (result.changes === 0) {
      // Already exists
      const existing = findTemplateBySkuStmt.get(combo.sku);
      templateId = existing ? existing.id : null;
    } else {
      templateId = result.lastInsertRowid;
    }

    if (!templateId) {
      basicSkipped++;
      continue;
    }

    comboSkuToId[combo.sku] = templateId;

    // Only add slots if this was a fresh insert
    if (result.changes > 0) {
      for (const slot of slots) {
        insertSlot.run(
          templateId,
          slot.slotName,
          slot.sortOrder,
          slot.slotType,
          1,
          null, // fixedProductId
          null, // fixedComboId
          slot.filterCategory,
          slot.filterKeywords
        );
      }
      basicOk++;
    } else {
      basicOk++; // already existed, still register in map
    }
  }
});

importBasicCombos();
console.log(`  Created/found ${basicOk} basic combos, skipped ${basicSkipped}`);
console.log(`  Combo SKU map: ${Object.keys(comboSkuToId).length} entries`);

// ─── Phase 2: Import PC builds ────────────────────────────────────────────────

console.log("\n── Phase 2: Importing PC builds ─────────────────────────────");

let pcOk = 0, pcSkipped = 0, slotErrors = 0;

const importPcBuilds = db.transaction(() => {
  for (const pc of pcBuilds) {
    // Find the product in the DB by SKU to link the combo
    const product = findProductBySkuStmt.get(pc.sku);
    const productId = product ? product.id : null;

    const result = insertTemplate.run(pc.name, pc.sku, productId, pc.notes || null);
    let templateId;

    if (result.changes === 0) {
      const existing = findTemplateBySkuStmt.get(pc.sku);
      templateId = existing ? existing.id : null;
    } else {
      templateId = result.lastInsertRowid;
    }

    if (!templateId) {
      pcSkipped++;
      continue;
    }

    // Only add slots if this was a fresh insert
    if (result.changes === 0) {
      pcOk++;
      continue;
    }

    let slotOrder = 1;
    let hasErrors = false;

    for (const slot of pc.slots) {
      const def = buildPcSlotDef(slot.slotType, slot.slotId, slot.slotName, comboSkuToId);
      if (!def) {
        // Unknown slot type — skip but log
        slotErrors++;
        hasErrors = true;
        continue;
      }

      insertSlot.run(
        templateId,
        slot.slotName || slot.slotType,
        slotOrder++,
        def.slotType,
        slot.qty,
        def.fixedProductId ?? null,
        def.fixedComboId ?? null,
        def.filterCategory ?? null,
        def.filterKeywords ?? null
      );
    }

    if (hasErrors) pcSkipped++; // count as partial
    else pcOk++;
  }
});

importPcBuilds();

console.log(`  Created ${pcOk} PC builds, issues with ${pcSkipped}, slot errors: ${slotErrors}`);

// ─── Summary ─────────────────────────────────────────────────────────────────

const totalTemplates = db.prepare("SELECT COUNT(*) as cnt FROM combo_templates").get().cnt;
const totalSlots     = db.prepare("SELECT COUNT(*) as cnt FROM combo_slots").get().cnt;
const linkedPcs      = db.prepare("SELECT COUNT(*) as cnt FROM combo_templates WHERE product_id IS NOT NULL").get().cnt;
const comboSlots     = db.prepare("SELECT COUNT(*) as cnt FROM combo_slots WHERE slot_type = 'combo'").get().cnt;

console.log("\n── Summary ──────────────────────────────────────────────────");
console.log(`  Total combo templates: ${totalTemplates}`);
console.log(`  Total slots:          ${totalSlots}`);
console.log(`  PC combos linked to products: ${linkedPcs}`);
console.log(`  Combo-type slots:     ${comboSlots}`);
console.log("\nDone! Run /api/combos/refresh-all to calculate prices.");
