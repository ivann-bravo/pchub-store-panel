import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates } from "@/lib/db/schema";

// GET /api/combos/detect-pctry
// Returns products with SKU starting with "PCTRY" that have no linked combo_template
export async function GET() {
  try {
    // Get all productIds that are already linked to a combo template
    const linked = db.select({ productId: comboTemplates.productId }).from(comboTemplates).all();
    const linkedIds = new Set(
      linked.map((r) => r.productId).filter((id): id is number => id !== null)
    );

    // Get all PCTRY products
    const pctrys = db.$client
      .prepare(
        `SELECT id, name, sku, woocommerce_id, own_price_regular, has_supplier_stock
         FROM products
         WHERE sku LIKE 'PCTRY%'
         ORDER BY sku`
      )
      .all() as {
      id: number;
      name: string;
      sku: string;
      woocommerce_id: number | null;
      own_price_regular: number | null;
      has_supplier_stock: number;
    }[];

    const unlinked = pctrys.filter((p) => !linkedIds.has(p.id));

    return NextResponse.json({
      total: pctrys.length,
      unlinked: unlinked.length,
      products: unlinked.map((p) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        woocommerceId: p.woocommerce_id,
        ownPriceRegular: p.own_price_regular,
        hasSupplierStock: Boolean(p.has_supplier_stock),
      })),
    });
  } catch (error) {
    console.error("GET /api/combos/detect-pctry error:", error);
    return NextResponse.json({ error: "Error al detectar productos PCTRY" }, { status: 500 });
  }
}
