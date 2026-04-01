import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Simple 60-second in-memory cache — stats don't need to be real-time
let cachedStats: unknown = null;
let cacheExpiresAt = 0;

export async function GET() {
  try {
    if (cachedStats && Date.now() < cacheExpiresAt) {
      return NextResponse.json(cachedStats);
    }

    const sqlite = db.$client;

    // Single query for all product-level aggregates
    const productStats = sqlite.prepare(`
      SELECT
        COUNT(*) as total_products,
        COUNT(CASE WHEN markup_offer IS NOT NULL AND offer_end >= date('now') THEN 1 END) as on_offer,
        COUNT(DISTINCT category) as categories_count,
        COUNT(DISTINCT brand) as brands_count
      FROM products
    `).get() as {
      total_products: number;
      on_offer: number;
      categories_count: number;
      brands_count: number;
    };

    // Products with at least one supplier price (needs a join, kept separate)
    const withPriceRow = sqlite.prepare(`
      SELECT COUNT(DISTINCT psl.product_id) as with_price
      FROM product_supplier_links psl
      INNER JOIN supplier_prices sp ON sp.link_id = psl.id
    `).get() as { with_price: number };

    // Suppliers count + recent imports in one query per table
    const totalSuppliersRow = sqlite.prepare(`
      SELECT COUNT(*) as total_suppliers FROM suppliers
    `).get() as { total_suppliers: number };

    const recentImports = sqlite.prepare(`
      SELECT sc.id, sc.filename, sc.row_count, sc.linked_count, sc.imported_at, sc.status, s.name as supplier_name
      FROM supplier_catalogs sc
      INNER JOIN suppliers s ON s.id = sc.supplier_id
      ORDER BY sc.imported_at DESC
      LIMIT 5
    `).all() as Array<{
      id: number;
      filename: string;
      row_count: number;
      linked_count: number | null;
      imported_at: string;
      status: string;
      supplier_name: string;
    }>;

    const result = {
      totalProducts: productStats.total_products,
      withPrice: withPriceRow.with_price,
      withoutPrice: productStats.total_products - withPriceRow.with_price,
      onOffer: productStats.on_offer,
      totalSuppliers: totalSuppliersRow.total_suppliers,
      categoriesCount: productStats.categories_count,
      brandsCount: productStats.brands_count,
      recentImports: recentImports.map((r) => ({
        id: r.id,
        filename: r.filename,
        rowCount: r.row_count,
        linkedCount: r.linked_count,
        importedAt: r.imported_at,
        status: r.status,
        supplierName: r.supplier_name,
      })),
    };

    cachedStats = result;
    cacheExpiresAt = Date.now() + 60_000; // 60 seconds

    return NextResponse.json(result);
  } catch (error) {
    console.error("GET /api/stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
