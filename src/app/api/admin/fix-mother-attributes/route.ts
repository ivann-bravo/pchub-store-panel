/**
 * GET  /api/admin/fix-mother-attributes
 *   → Muestra el estado actual de todos los combo slots de mothers:
 *     keywords actuales, atributos actuales, y qué cambiaría.
 *     Solo lectura — no toca nada.
 *
 * POST /api/admin/fix-mother-attributes
 *   → Aplica los cambios: limpia socket tokens de keywords y setea filterAttributes.
 *     ?dry=1 → simula sin escribir a la DB.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products, comboSlots, comboTemplates } from "@/lib/db/schema";
import { like, or, eq, asc } from "drizzle-orm";

// ── Chipset → socket + memoryType ─────────────────────────────────────────────
// null memoryType = chipset tiene variantes DDR4 y DDR5 (B760, Z790, H770).
const CHIPSET_ATTRS: Record<string, { socket: string; memoryType: string | null }> = {
  // Intel LGA 1151 (DDR4)
  H310: { socket: "LGA 1151", memoryType: "DDR4" },
  B360: { socket: "LGA 1151", memoryType: "DDR4" },
  H370: { socket: "LGA 1151", memoryType: "DDR4" },
  Z370: { socket: "LGA 1151", memoryType: "DDR4" },
  Z390: { socket: "LGA 1151", memoryType: "DDR4" },
  // Intel LGA 1200 (DDR4)
  H410: { socket: "LGA 1200", memoryType: "DDR4" },
  B460: { socket: "LGA 1200", memoryType: "DDR4" },
  H510: { socket: "LGA 1200", memoryType: "DDR4" },
  B560: { socket: "LGA 1200", memoryType: "DDR4" },
  Z490: { socket: "LGA 1200", memoryType: "DDR4" },
  Z590: { socket: "LGA 1200", memoryType: "DDR4" },
  // Intel LGA 1700 DDR4-only
  H610: { socket: "LGA 1700", memoryType: "DDR4" },
  B660: { socket: "LGA 1700", memoryType: "DDR4" },
  H670: { socket: "LGA 1700", memoryType: "DDR4" },
  Z690: { socket: "LGA 1700", memoryType: "DDR4" },
  // Intel LGA 1700 ambiguous (DDR4 y DDR5)
  B760: { socket: "LGA 1700", memoryType: null },
  H770: { socket: "LGA 1700", memoryType: null },
  Z790: { socket: "LGA 1700", memoryType: null },
  // Intel LGA 1851 (DDR5)
  H810: { socket: "LGA 1851", memoryType: "DDR5" },
  B860: { socket: "LGA 1851", memoryType: "DDR5" },
  Z890: { socket: "LGA 1851", memoryType: "DDR5" },
  // AMD AM4 (DDR4)
  A320: { socket: "AM4", memoryType: "DDR4" },
  A520: { socket: "AM4", memoryType: "DDR4" },
  B350: { socket: "AM4", memoryType: "DDR4" },
  B450: { socket: "AM4", memoryType: "DDR4" },
  B550: { socket: "AM4", memoryType: "DDR4" },
  X370: { socket: "AM4", memoryType: "DDR4" },
  X470: { socket: "AM4", memoryType: "DDR4" },
  X570: { socket: "AM4", memoryType: "DDR4" },
  // AMD AM5 (DDR5)
  A620: { socket: "AM5", memoryType: "DDR5" },
  B650: { socket: "AM5", memoryType: "DDR5" },
  B650E: { socket: "AM5", memoryType: "DDR5" },
  X670: { socket: "AM5", memoryType: "DDR5" },
  X670E: { socket: "AM5", memoryType: "DDR5" },
  X870: { socket: "AM5", memoryType: "DDR5" },
  X870E: { socket: "AM5", memoryType: "DDR5" },
};

// Sort longest-first so "B650E" matches before "B650"
const CHIPSET_ENTRIES = Object.entries(CHIPSET_ATTRS).sort(([a], [b]) => b.length - a.length);
const CHIPSET_NAMES = new Set(Object.keys(CHIPSET_ATTRS));

// Socket tokens that should NOT be in keywords (they belong in filterAttributes)
const SOCKET_TOKENS = new Set(["1151", "1200", "1700", "1851"]);
// AM4/AM5 should be removed from keywords only if a chipset keyword is also present
const AMD_SOCKET_TOKENS = new Set(["AM4", "AM5"]);

interface SlotAnalysis {
  slotId: number;
  comboId: number;
  comboName: string;
  slotName: string;
  filterCategory: string;
  currentKeywords: string[];
  currentAttributes: Record<string, string>;
  // Proposed changes
  proposedKeywords: string[];           // keywords after cleanup
  proposedAttributes: Record<string, string>;
  inferredSocket: string | null;
  inferredMemoryType: string | null;
  warnings: string[];
  hasChanges: boolean;
}

function analyzeSlot(
  slot: {
    id: number;
    slotName: string | null;
    filterCategory: string | null;
    filterKeywords: string | null;
    filterAttributes: string | null;
  },
  comboId: number,
  comboName: string
): SlotAnalysis {
  const warnings: string[] = [];

  let currentKeywords: string[] = [];
  try {
    const parsed = JSON.parse(slot.filterKeywords ?? "[]");
    currentKeywords = Array.isArray(parsed) ? parsed.map((k: unknown) => String(k).trim()).filter(Boolean) : [];
  } catch { /* ignore */ }

  let currentAttributes: Record<string, string> = {};
  try { currentAttributes = JSON.parse(slot.filterAttributes ?? "{}"); } catch { /* ignore */ }

  // ── Infer socket + memoryType from chipset keywords ──────────────────────
  let inferredSocket: string | null = null;
  let inferredMemoryType: string | null = null;
  const chipsetKeywords: string[] = [];

  for (const kw of currentKeywords) {
    const upper = kw.toUpperCase().trim();
    // Check for exact chipset match
    const found = CHIPSET_ENTRIES.find(([chipset]) => upper === chipset);
    if (found) {
      chipsetKeywords.push(kw);
      if (!inferredSocket) {
        inferredSocket = found[1].socket;
        inferredMemoryType = found[1].memoryType;
      } else if (inferredSocket !== found[1].socket) {
        warnings.push(`Chipsets con sockets distintos en el mismo slot: conflicto entre ${inferredSocket} y ${found[1].socket}`);
      }
    }
  }

  // For ambiguous chipsets: try to resolve memoryType from keywords containing DDR hint
  if (inferredSocket && inferredMemoryType === null) {
    const kwText = currentKeywords.join(" ").toUpperCase();
    if (kwText.includes("DDR5")) inferredMemoryType = "DDR5";
    else if (kwText.includes("DDR4")) inferredMemoryType = "DDR4";
    else warnings.push(`Chipset ambiguo (DDR4/DDR5) sin hint en keywords — solo se seteará el socket`);
  }

  if (!inferredSocket) {
    warnings.push(`No se encontró ningún chipset conocido en los keywords`);
  }

  // ── Build proposed keywords: remove socket tokens ─────────────────────────
  const hasChipsetKeywords = chipsetKeywords.length > 0;
  const proposedKeywords = currentKeywords.filter((kw) => {
    const upper = kw.toUpperCase().trim();
    if (SOCKET_TOKENS.has(upper)) return false;  // always remove intel socket numbers
    if (AMD_SOCKET_TOKENS.has(upper) && hasChipsetKeywords) return false;  // remove AM4/AM5 if chipset present
    return true;
  });

  // Warn if socket tokens were in keywords
  const removedSocketTokens = currentKeywords.filter((kw) => {
    const upper = kw.toUpperCase().trim();
    return SOCKET_TOKENS.has(upper) || (AMD_SOCKET_TOKENS.has(upper) && hasChipsetKeywords);
  });
  if (removedSocketTokens.length > 0) {
    warnings.push(`Socket tokens en keywords (se eliminarán): ${removedSocketTokens.join(", ")}`);
  }

  // Warn if no keywords left that are chipset names (would match too broadly)
  const chipsetAfterClean = proposedKeywords.filter((kw) => CHIPSET_NAMES.has(kw.toUpperCase().trim()));
  if (chipsetAfterClean.length === 0 && proposedKeywords.length > 0) {
    warnings.push(`Después de limpiar no quedan chipsets en keywords — revisar manualmente`);
  }

  // ── Build proposed attributes ─────────────────────────────────────────────
  const proposedAttributes = { ...currentAttributes };
  if (inferredSocket) proposedAttributes.socket = inferredSocket;
  if (inferredMemoryType) proposedAttributes.memoryType = inferredMemoryType;

  // ── Detect changes ────────────────────────────────────────────────────────
  const keywordsChanged = JSON.stringify(currentKeywords) !== JSON.stringify(proposedKeywords);
  const attrsChanged = JSON.stringify(currentAttributes) !== JSON.stringify(proposedAttributes);
  const hasChanges = keywordsChanged || attrsChanged;

  return {
    slotId: slot.id,
    comboId,
    comboName,
    slotName: slot.slotName ?? "",
    filterCategory: slot.filterCategory ?? "",
    currentKeywords,
    currentAttributes,
    proposedKeywords,
    proposedAttributes,
    inferredSocket,
    inferredMemoryType,
    warnings,
    hasChanges,
  };
}

// ── Shared auth check ─────────────────────────────────────────────────────────
async function checkAuth() {
  const session = await getServerSession(authOptions);
  if (!session || (session.user as { role?: string }).role !== "SUPER_ADMIN") return false;
  return true;
}

// ── GET: review current state ─────────────────────────────────────────────────
export async function GET() {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const templates = db.select({ id: comboTemplates.id, name: comboTemplates.name })
    .from(comboTemplates).orderBy(asc(comboTemplates.name)).all();
  const templateMap: Record<number, string> = {};
  for (const t of templates) templateMap[t.id] = t.name;

  const motherSlots = db
    .select({
      id: comboSlots.id,
      templateId: comboSlots.templateId,
      slotType: comboSlots.slotType,
      slotName: comboSlots.slotName,
      filterCategory: comboSlots.filterCategory,
      filterKeywords: comboSlots.filterKeywords,
      filterAttributes: comboSlots.filterAttributes,
    })
    .from(comboSlots)
    .where(
      or(
        like(comboSlots.filterCategory, "%Mother%"),
        like(comboSlots.filterCategory, "%mother%"),
        like(comboSlots.filterCategory, "%Placa Madre%"),
        like(comboSlots.filterCategory, "%Mainboard%"),
      )
    )
    .orderBy(asc(comboSlots.templateId))
    .all();

  const results = motherSlots
    .filter((s) => s.slotType === "auto")
    .map((s) => analyzeSlot(s, s.templateId, templateMap[s.templateId] ?? `Combo #${s.templateId}`));

  const withChanges = results.filter((r) => r.hasChanges);
  const withWarnings = results.filter((r) => r.warnings.length > 0);

  return NextResponse.json({
    summary: {
      totalSlots: results.length,
      slotsWithChanges: withChanges.length,
      slotsWithWarnings: withWarnings.length,
    },
    slots: results,
  });
}

// ── POST: apply fix ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry") === "1";

  // ── Fix combo slots ──────────────────────────────────────────────────────
  const templates = db.select({ id: comboTemplates.id, name: comboTemplates.name })
    .from(comboTemplates).all();
  const templateMap: Record<number, string> = {};
  for (const t of templates) templateMap[t.id] = t.name;

  const motherSlots = db
    .select({
      id: comboSlots.id,
      templateId: comboSlots.templateId,
      slotType: comboSlots.slotType,
      slotName: comboSlots.slotName,
      filterCategory: comboSlots.filterCategory,
      filterKeywords: comboSlots.filterKeywords,
      filterAttributes: comboSlots.filterAttributes,
    })
    .from(comboSlots)
    .where(
      or(
        like(comboSlots.filterCategory, "%Mother%"),
        like(comboSlots.filterCategory, "%mother%"),
        like(comboSlots.filterCategory, "%Placa Madre%"),
        like(comboSlots.filterCategory, "%Mainboard%"),
      )
    )
    .all();

  let slotsUpdated = 0;
  const applied: { slotId: number; comboName: string; slotName: string; change: string }[] = [];

  for (const slot of motherSlots) {
    if (slot.slotType !== "auto") continue;
    const analysis = analyzeSlot(slot, slot.templateId, templateMap[slot.templateId] ?? `#${slot.templateId}`);
    if (!analysis.hasChanges) continue;

    if (!dryRun) {
      db.update(comboSlots)
        .set({
          filterKeywords: JSON.stringify(analysis.proposedKeywords),
          filterAttributes: JSON.stringify(analysis.proposedAttributes),
        })
        .where(eq(comboSlots.id, slot.id))
        .run();
    }

    slotsUpdated++;
    applied.push({
      slotId: slot.id,
      comboName: analysis.comboName,
      slotName: analysis.slotName,
      change: `keywords: [${analysis.currentKeywords.join(",")}] → [${analysis.proposedKeywords.join(",")}] | attrs: ${JSON.stringify(analysis.proposedAttributes)}`,
    });
  }

  // ── Fix product attributes ───────────────────────────────────────────────
  const motherProducts = db
    .select({ id: products.id, name: products.name, attributes: products.attributes })
    .from(products)
    .where(or(
      like(products.category, "%Mother%"),
      like(products.category, "%mother%"),
      like(products.category, "%Placa Madre%"),
      like(products.category, "%Mainboard%"),
    ))
    .all();

  let productsUpdated = 0;
  for (const product of motherProducts) {
    const upper = product.name.toUpperCase();
    let inferred: { socket: string; memoryType: string | null } | null = null;
    for (const [chipset, attrs] of CHIPSET_ENTRIES) {
      if (upper.includes(chipset)) { inferred = attrs; break; }
    }
    if (!inferred) {
      if (upper.includes("AM5")) inferred = { socket: "AM5", memoryType: "DDR5" };
      else if (upper.includes("AM4")) inferred = { socket: "AM4", memoryType: "DDR4" };
    }
    if (!inferred) continue;

    let attrs: Record<string, unknown> = {};
    try { attrs = JSON.parse(product.attributes ?? "{}"); } catch { /* ignore */ }

    let changed = false;
    if (!attrs.socket) { attrs.socket = inferred.socket; changed = true; }
    if (!attrs.memoryType && inferred.memoryType) { attrs.memoryType = inferred.memoryType; changed = true; }
    if (!changed) continue;

    if (!dryRun) {
      db.update(products).set({ attributes: JSON.stringify(attrs) }).where(eq(products.id, product.id)).run();
    }
    productsUpdated++;
  }

  return NextResponse.json({
    dryRun,
    slotsUpdated,
    productsUpdated,
    applied,
  });
}
