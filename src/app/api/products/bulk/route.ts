import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { sql, inArray } from "drizzle-orm";

const ALLOWED_BULK_FIELDS = new Set([
  "category", "brand", "markupRegular", "markupOffer",
  "ivaRate", "internalTaxRate", "localStock",
]);

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids, updates } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "ids array required" }, { status: 400 });
    }

    if (!updates || typeof updates !== "object") {
      return NextResponse.json({ error: "updates object required" }, { status: 400 });
    }

    // Filter to only allowed fields
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_BULK_FIELDS.has(key)) {
        sanitized[key] = value;
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    // Update all products with matching IDs
    const result = db
      .update(products)
      .set({
        ...sanitized,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(inArray(products.id, ids))
      .run();

    return NextResponse.json({ updated: result.changes });
  } catch (error) {
    console.error("Bulk update error:", error);
    return NextResponse.json({ error: "Failed to bulk update" }, { status: 500 });
  }
}
