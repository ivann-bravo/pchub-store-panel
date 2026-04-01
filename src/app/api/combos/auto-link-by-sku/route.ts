import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates, products } from "@/lib/db/schema";
import { isNull, eq, sql } from "drizzle-orm";

// POST /api/combos/auto-link-by-sku
// For every combo template whose product_id is NULL, find a product with the same SKU and link them.
export async function POST() {
  try {
    // Get all unlinked templates
    const unlinked = db
      .select({ id: comboTemplates.id, sku: comboTemplates.sku })
      .from(comboTemplates)
      .where(isNull(comboTemplates.productId))
      .all();

    if (unlinked.length === 0) {
      return NextResponse.json({ linked: 0, message: "No hay templates sin vincular" });
    }

    let linked = 0;
    const details: { templateId: number; sku: string; productId: number }[] = [];

    for (const template of unlinked) {
      const product = db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.sku, template.sku))
        .get();

      if (product) {
        db.update(comboTemplates)
          .set({
            productId: product.id,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(comboTemplates.id, template.id))
          .run();
        linked++;
        details.push({ templateId: template.id, sku: template.sku, productId: product.id });
      }
    }

    return NextResponse.json({
      checked: unlinked.length,
      linked,
      skipped: unlinked.length - linked,
      details,
    });
  } catch (error) {
    console.error("POST /api/combos/auto-link-by-sku error:", error);
    return NextResponse.json({ error: "Error al vincular por SKU" }, { status: 500 });
  }
}

// GET: preview — how many would be linked without actually doing it
export async function GET() {
  try {
    const unlinked = db
      .select({ id: comboTemplates.id, sku: comboTemplates.sku })
      .from(comboTemplates)
      .where(isNull(comboTemplates.productId))
      .all();

    let wouldLink = 0;
    for (const template of unlinked) {
      const product = db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.sku, template.sku))
        .get();
      if (product) wouldLink++;
    }

    return NextResponse.json({
      unlinkedTemplates: unlinked.length,
      wouldLink,
      wouldSkip: unlinked.length - wouldLink,
    });
  } catch {
    return NextResponse.json({ error: "Error" }, { status: 500 });
  }
}
