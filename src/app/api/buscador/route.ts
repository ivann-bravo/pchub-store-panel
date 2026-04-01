import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { buscadorItems } from "@/lib/db/schema";
import { asc } from "drizzle-orm";

// GET /api/buscador — list all items ordered by group + sortOrder
export async function GET() {
  try {
    const items = db
      .select()
      .from(buscadorItems)
      .orderBy(asc(buscadorItems.sortOrder), asc(buscadorItems.id))
      .all();
    return NextResponse.json(items);
  } catch (error) {
    console.error("GET /api/buscador error:", error);
    return NextResponse.json({ error: "Error al obtener buscador" }, { status: 500 });
  }
}

// POST /api/buscador — create a new item
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { groupName, label, filterCategory, filterMustKeywords, filterKeywords, filterAttributes, filterMinPrice, filterMaxPrice, sortOrder } = body;

    if (!groupName || !label || !filterCategory) {
      return NextResponse.json(
        { error: "groupName, label y filterCategory son requeridos" },
        { status: 400 }
      );
    }

    const item = db
      .insert(buscadorItems)
      .values({
        groupName,
        label,
        filterCategory,
        filterMustKeywords: filterMustKeywords ? JSON.stringify(filterMustKeywords) : null,
        filterKeywords: filterKeywords ? JSON.stringify(filterKeywords) : null,
        filterAttributes: filterAttributes ? JSON.stringify(filterAttributes) : null,
        filterMinPrice: filterMinPrice ?? null,
        filterMaxPrice: filterMaxPrice ?? null,
        sortOrder: sortOrder ?? 0,
      })
      .returning()
      .get();

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("POST /api/buscador error:", error);
    return NextResponse.json({ error: "Error al crear item" }, { status: 500 });
  }
}
