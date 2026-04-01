import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates, comboSlots, products } from "@/lib/db/schema";
import { eq, asc, sql, inArray } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const template = db.select().from(comboTemplates).where(eq(comboTemplates.id, id)).get();
  if (!template) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const slots = db
    .select()
    .from(comboSlots)
    .where(eq(comboSlots.templateId, id))
    .orderBy(asc(comboSlots.sortOrder))
    .all();

  // Enrich slots with resolved product names
  const resolvedIds = slots
    .map((s) => s.resolvedProductId)
    .filter((pid): pid is number => pid != null);
  const productNameMap: Record<number, string> = {};
  if (resolvedIds.length > 0) {
    const rows = db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, resolvedIds))
      .all();
    for (const row of rows) {
      productNameMap[row.id] = row.name;
    }
  }
  const slotsWithNames = slots.map((s) => ({
    ...s,
    resolvedProductName: s.resolvedProductId != null ? (productNameMap[s.resolvedProductId] ?? null) : null,
  }));

  return NextResponse.json({ ...template, slots: slotsWithNames });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  try {
    const body = await request.json();

    const allowed = new Set(["name", "sku", "productId", "isActive", "notes", "description"]);
    const updates: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (allowed.has(k)) updates[k] = v;
    }

    if (Object.keys(updates).length > 0) {
      db.update(comboTemplates)
        .set({ ...updates, updatedAt: sql`(datetime('now'))` })
        .where(eq(comboTemplates.id, id))
        .run();
    }

    // Replace all slots if provided
    if (Array.isArray(body.slots)) {
      db.delete(comboSlots).where(eq(comboSlots.templateId, id)).run();
      for (const slot of body.slots) {
        db.insert(comboSlots)
          .values({
            templateId: id,
            slotName: slot.slotName,
            slotType: slot.slotType,
            quantity: slot.quantity ?? 1,
            sortOrder: slot.sortOrder ?? 0,
            fixedProductId: slot.fixedProductId ?? null,
            fixedComboId: slot.fixedComboId ?? null,
            filterCategory: slot.filterCategory ?? null,
            filterKeywords: slot.filterKeywords
              ? JSON.stringify(
                  Array.isArray(slot.filterKeywords)
                    ? slot.filterKeywords
                    : JSON.parse(slot.filterKeywords)
                )
              : null,
            filterAttributes: slot.filterAttributes
              ? JSON.stringify(
                  typeof slot.filterAttributes === "object"
                    ? slot.filterAttributes
                    : JSON.parse(slot.filterAttributes)
                )
              : null,
          })
          .run();
      }
    }

    const updated = db.select().from(comboTemplates).where(eq(comboTemplates.id, id)).get();
    const slots = db
      .select()
      .from(comboSlots)
      .where(eq(comboSlots.templateId, id))
      .orderBy(asc(comboSlots.sortOrder))
      .all();

    return NextResponse.json({ ...updated, slots });
  } catch (error) {
    console.error("PATCH /api/combos/[id] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al actualizar" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  db.delete(comboTemplates).where(eq(comboTemplates.id, id)).run();

  return NextResponse.json({ success: true });
}
