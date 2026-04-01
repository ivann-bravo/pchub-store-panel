import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates, products } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

// POST /api/combos/bulk-create-from-products
// Body: { productIds: number[] }
// Creates one combo_template per product (SKU + name from product), no slots
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { productIds } = body as { productIds: number[] };

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: "productIds es requerido y debe ser un array no vacío" }, { status: 400 });
    }

    // Fetch the products
    const prods = db
      .select({ id: products.id, name: products.name, sku: products.sku })
      .from(products)
      .where(inArray(products.id, productIds))
      .all();

    if (prods.length === 0) {
      return NextResponse.json({ error: "No se encontraron productos" }, { status: 404 });
    }

    // Get existing templates to skip duplicates
    const existing = db
      .select({ productId: comboTemplates.productId, sku: comboTemplates.sku })
      .from(comboTemplates)
      .all();
    const existingProductIds = new Set(existing.map((t) => t.productId).filter((id): id is number => id !== null));
    const existingSkus = new Set(existing.map((t) => t.sku));

    const created: { id: number; sku: string; name: string }[] = [];
    const skipped: { productId: number; reason: string }[] = [];

    for (const prod of prods) {
      if (existingProductIds.has(prod.id)) {
        skipped.push({ productId: prod.id, reason: "Ya tiene combo vinculado" });
        continue;
      }
      if (!prod.sku) {
        skipped.push({ productId: prod.id, reason: "Producto sin SKU" });
        continue;
      }
      if (existingSkus.has(prod.sku)) {
        skipped.push({ productId: prod.id, reason: `SKU ${prod.sku} ya existe en otro combo` });
        continue;
      }

      const template = db
        .insert(comboTemplates)
        .values({
          name: prod.name,
          sku: prod.sku,
          productId: prod.id,
          isActive: true,
          notes: "Creado desde vinculación masiva PCTRY",
        })
        .returning()
        .get();

      existingSkus.add(prod.sku);
      created.push({ id: template.id, sku: template.sku, name: template.name });
    }

    return NextResponse.json({
      success: true,
      created: created.length,
      skipped: skipped.length,
      templates: created,
      skippedDetails: skipped,
    });
  } catch (error) {
    console.error("POST /api/combos/bulk-create-from-products error:", error);
    return NextResponse.json({ error: "Error al crear templates" }, { status: 500 });
  }
}
