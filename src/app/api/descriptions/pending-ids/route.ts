import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, comboTemplates } from "@/lib/db/schema";
import { isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "products";

  if (type === "combos") {
    const rows = db
      .select({ id: comboTemplates.id })
      .from(comboTemplates)
      .where(isNull(comboTemplates.description))
      .all();
    return NextResponse.json({ ids: rows.map((r) => r.id) });
  }

  // Default: products
  const rows = db
    .select({ id: products.id })
    .from(products)
    .where(isNull(products.description))
    .all();
  return NextResponse.json({ ids: rows.map((r) => r.id) });
}
