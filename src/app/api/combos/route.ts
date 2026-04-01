import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates, comboSlots } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

export async function GET() {
  const templates = db.select().from(comboTemplates).orderBy(asc(comboTemplates.sku)).all();

  const result = templates.map((t) => {
    const slots = db
      .select()
      .from(comboSlots)
      .where(eq(comboSlots.templateId, t.id))
      .orderBy(asc(comboSlots.sortOrder))
      .all();
    return { ...t, slots };
  });

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.sku) {
      return NextResponse.json({ error: "name y sku son requeridos" }, { status: 400 });
    }

    const template = db
      .insert(comboTemplates)
      .values({
        name: body.name,
        sku: body.sku.trim().toUpperCase(),
        productId: body.productId ?? null,
        notes: body.notes ?? null,
      })
      .returning()
      .get();

    if (Array.isArray(body.slots) && body.slots.length > 0) {
      for (const slot of body.slots) {
        db.insert(comboSlots)
          .values({
            templateId: template.id,
            slotName: slot.slotName,
            slotType: slot.slotType,
            quantity: slot.quantity ?? 1,
            sortOrder: slot.sortOrder ?? 0,
            fixedProductId: slot.fixedProductId ?? null,
            filterCategory: slot.filterCategory ?? null,
            filterKeywords: slot.filterKeywords
              ? JSON.stringify(
                  Array.isArray(slot.filterKeywords)
                    ? slot.filterKeywords
                    : JSON.parse(slot.filterKeywords)
                )
              : null,
          })
          .run();
      }
    }

    const slots = db
      .select()
      .from(comboSlots)
      .where(eq(comboSlots.templateId, template.id))
      .orderBy(asc(comboSlots.sortOrder))
      .all();

    return NextResponse.json({ ...template, slots }, { status: 201 });
  } catch (error) {
    console.error("POST /api/combos error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al crear combo" },
      { status: 500 }
    );
  }
}
