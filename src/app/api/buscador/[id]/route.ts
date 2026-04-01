import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buscadorItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// PATCH /api/buscador/[id] — update label, category, keywords, sortOrder
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const itemId = parseInt(id);
    if (isNaN(itemId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.label !== undefined) updates.label = body.label;
    if (body.groupName !== undefined) updates.groupName = body.groupName;
    if (body.filterCategory !== undefined) updates.filterCategory = body.filterCategory;
    if (body.filterMustKeywords !== undefined) {
      updates.filterMustKeywords =
        body.filterMustKeywords === null
          ? null
          : Array.isArray(body.filterMustKeywords)
          ? JSON.stringify(body.filterMustKeywords)
          : body.filterMustKeywords;
    }
    if (body.filterKeywords !== undefined) {
      updates.filterKeywords = Array.isArray(body.filterKeywords)
        ? JSON.stringify(body.filterKeywords)
        : body.filterKeywords;
    }
    if (body.filterAttributes !== undefined) {
      updates.filterAttributes =
        body.filterAttributes === null
          ? null
          : typeof body.filterAttributes === "object"
          ? JSON.stringify(body.filterAttributes)
          : body.filterAttributes;
    }
    if (body.filterMinPrice !== undefined) updates.filterMinPrice = body.filterMinPrice ?? null;
    if (body.filterMaxPrice !== undefined) updates.filterMaxPrice = body.filterMaxPrice ?? null;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    const item = db
      .update(buscadorItems)
      .set(updates)
      .where(eq(buscadorItems.id, itemId))
      .returning()
      .get();

    if (!item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
    }

    return NextResponse.json(item);
  } catch (error) {
    console.error("PATCH /api/buscador/[id] error:", error);
    return NextResponse.json({ error: "Error al actualizar item" }, { status: 500 });
  }
}

// DELETE /api/buscador/[id]
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const itemId = parseInt(id);
    if (isNaN(itemId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    db.delete(buscadorItems).where(eq(buscadorItems.id, itemId)).run();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/buscador/[id] error:", error);
    return NextResponse.json({ error: "Error al eliminar item" }, { status: 500 });
  }
}
