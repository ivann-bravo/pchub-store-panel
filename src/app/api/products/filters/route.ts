import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Builds the stock-related WHERE fragment (no placeholders needed, pure SQL)
function stockWhereSQL(localStock: string): string {
  const linkStockSubq = `EXISTS (
    SELECT 1 FROM product_supplier_links psl
    WHERE psl.product_id = p.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0
  )`;
  if (localStock === "local") return ` AND p.local_stock > 0`;
  if (localStock === "supplier") return ` AND (p.has_supplier_stock = 1 OR ${linkStockSubq})`;
  if (localStock === "any") return ` AND (p.local_stock > 0 OR p.has_supplier_stock = 1 OR ${linkStockSubq})`;
  if (localStock === "none") return ` AND p.local_stock = 0 AND p.has_supplier_stock = 0 AND NOT ${linkStockSubq}`;
  return "";
}

// Builds the supplier JOIN + WHERE fragment when supplier filter is active
function supplierJoinAndWhere(supplierIds: number[]): { join: string; where: string; params: number[] } {
  if (supplierIds.length === 0) return { join: "", where: "", params: [] };
  const placeholders = supplierIds.map(() => "?").join(",");
  const join = `
    LEFT JOIN (
      SELECT psl.product_id, s.code as supplier_code
      FROM product_supplier_links psl
      INNER JOIN supplier_prices sp ON sp.link_id = psl.id
      INNER JOIN suppliers s ON s.id = psl.supplier_id
      WHERE psl.is_active = 1
      GROUP BY psl.product_id, s.id
    ) linked_s ON linked_s.product_id = p.id
  `;
  const where =
    supplierIds.length === 1
      ? ` AND linked_s.supplier_code = (SELECT code FROM suppliers WHERE id = ?)`
      : ` AND linked_s.supplier_code IN (SELECT code FROM suppliers WHERE id IN (${placeholders}))`;
  return { join, where, params: supplierIds };
}

export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;

    const search = sp.get("search") || "";
    const categoriesParam = sp.get("categories") || "";
    const brandsParam = sp.get("brands") || "";
    const suppliersParam = sp.get("suppliers") || "";
    const localStock = sp.get("localStock") || "";

    const categories = categoriesParam ? categoriesParam.split(",").filter(Boolean) : [];
    const brands = brandsParam ? brandsParam.split(",").filter(Boolean) : [];
    const supplierIds = suppliersParam ? suppliersParam.split(",").map(Number).filter(Boolean) : [];

    // ── Shared WHERE fragments ──────────────────────────────────────────────
    let searchSQL = "";
    const searchParams: string[] = [];
    if (search) {
      searchSQL = ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.ean_upc LIKE ?)`;
      const pat = `%${search}%`;
      searchParams.push(pat, pat, pat);
    }

    const categoriesSQL =
      categories.length === 1
        ? ` AND p.category = ?`
        : categories.length > 1
        ? ` AND p.category IN (${categories.map(() => "?").join(",")})`
        : "";

    const brandsSQL =
      brands.length === 1
        ? ` AND p.brand = ?`
        : brands.length > 1
        ? ` AND p.brand IN (${brands.map(() => "?").join(",")})`
        : "";

    const stockSQL = stockWhereSQL(localStock);
    const { join: supplierJoin, where: supplierWhere, params: supplierParams } = supplierJoinAndWhere(supplierIds);

    // ── Available categories (apply: search + brands + suppliers + stock) ──
    const catQuery = `
      SELECT DISTINCT p.category
      FROM products p ${supplierJoin}
      WHERE p.category IS NOT NULL AND p.category != ''
        ${searchSQL}${brandsSQL}${supplierWhere}${stockSQL}
      ORDER BY p.category
    `;
    const catParams: (string | number)[] = [
      ...searchParams,
      ...brands,
      ...supplierParams,
    ];
    const catRows = db.$client.prepare(catQuery).all(...catParams) as { category: string }[];

    // ── Available brands (apply: search + categories + suppliers + stock) ──
    const brandQuery = `
      SELECT DISTINCT p.brand
      FROM products p ${supplierJoin}
      WHERE p.brand IS NOT NULL AND p.brand != ''
        ${searchSQL}${categoriesSQL}${supplierWhere}${stockSQL}
      ORDER BY p.brand
    `;
    const brandParams: (string | number)[] = [
      ...searchParams,
      ...categories,
      ...supplierParams,
    ];
    const brandRows = db.$client.prepare(brandQuery).all(...brandParams) as { brand: string }[];

    // ── Available suppliers (apply: search + categories + brands + stock) ──
    // For suppliers we join through product_supplier_links directly
    const suppQuery = `
      SELECT DISTINCT s.id, s.name, s.code
      FROM products p
      INNER JOIN product_supplier_links psl ON psl.product_id = p.id AND psl.is_active = 1
      INNER JOIN supplier_prices sp2 ON sp2.link_id = psl.id
      INNER JOIN suppliers s ON s.id = psl.supplier_id
      WHERE 1=1
        ${searchSQL}${categoriesSQL}${brandsSQL}${stockSQL}
      ORDER BY s.name
    `;
    const suppParams: (string | number)[] = [
      ...searchParams,
      ...categories,
      ...brands,
    ];
    const suppRows = db.$client.prepare(suppQuery).all(...suppParams) as {
      id: number;
      name: string;
      code: string;
    }[];

    return NextResponse.json({
      categories: catRows.map((r) => r.category),
      brands: brandRows.map((r) => r.brand),
      suppliers: suppRows,
    });
  } catch (error) {
    console.error("GET /api/products/filters error:", error);
    return NextResponse.json({ error: "Failed to fetch filters" }, { status: 500 });
  }
}
