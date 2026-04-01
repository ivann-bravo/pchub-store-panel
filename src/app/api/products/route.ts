import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products, productPriceHistory } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.max(1, Math.min(200, parseInt(searchParams.get("limit") || "50", 10)));
    const search = searchParams.get("search") || "";
    const categoriesParam = searchParams.get("categories") || searchParams.get("category") || "";
    const brandsParam = searchParams.get("brands") || searchParams.get("brand") || "";
    const suppliersParam = searchParams.get("suppliers") || searchParams.get("supplier") || "";
    const categories = categoriesParam ? categoriesParam.split(",").filter(Boolean) : [];
    const brands = brandsParam ? brandsParam.split(",").filter(Boolean) : [];
    const supplierIds = suppliersParam ? suppliersParam.split(",").map(Number).filter(Boolean) : [];
    const localStock = searchParams.get("localStock") || "";
    const hasStock = searchParams.get("hasStock");
    const hasPrice = searchParams.get("hasPrice");
    const wooManualPrivate = searchParams.get("wooManualPrivate");
    const sortBy = searchParams.get("sortBy") || "name";
    const sortOrder = searchParams.get("sortOrder") || "asc";

    const offset = (page - 1) * limit;
    const sortDirection = sortOrder === "desc" ? "DESC" : "ASC";

    const sortColumnMap: Record<string, string> = {
      name: "p.name",
      sku: "p.sku",
      category: "p.category",
      brand: "p.brand",
      bestSupplierCost: "p.best_cost_ars",
      clientPrice: "display_price",
      localStock: "p.local_stock",
      supplier: "p.best_supplier_code",
    };
    const sortColumn = sortColumnMap[sortBy] || "p.name";

    // Build WHERE clause as raw SQL (single implementation for both count and data)
    let whereSQL = "";
    const whereParams: (string | number)[] = [];

    if (search) {
      whereSQL += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.ean_upc LIKE ?)`;
      const pattern = `%${search}%`;
      whereParams.push(pattern, pattern, pattern);
    }
    if (categories.length === 1) {
      whereSQL += ` AND p.category = ?`;
      whereParams.push(categories[0]);
    } else if (categories.length > 1) {
      whereSQL += ` AND p.category IN (${categories.map(() => "?").join(",")})`;
      whereParams.push(...categories);
    }
    if (brands.length === 1) {
      whereSQL += ` AND p.brand = ?`;
      whereParams.push(brands[0]);
    } else if (brands.length > 1) {
      whereSQL += ` AND p.brand IN (${brands.map(() => "?").join(",")})`;
      whereParams.push(...brands);
    }
    if (supplierIds.length === 1) {
      whereSQL += ` AND p.best_supplier_code = (SELECT s.code FROM suppliers s WHERE s.id = ?)`;
      whereParams.push(supplierIds[0]);
    } else if (supplierIds.length > 1) {
      whereSQL += ` AND p.best_supplier_code IN (SELECT s.code FROM suppliers s WHERE s.id IN (${supplierIds.map(() => "?").join(",")}))`;
      whereParams.push(...supplierIds);
    }

    const linkStockSubq = `EXISTS (SELECT 1 FROM product_supplier_links psl WHERE psl.product_id = p.id AND psl.is_active = 1 AND psl.supplier_stock_qty > 0)`;
    if (localStock === "local") {
      whereSQL += ` AND p.local_stock > 0`;
    } else if (localStock === "supplier") {
      whereSQL += ` AND (p.has_supplier_stock = 1 OR ${linkStockSubq})`;
    } else if (localStock === "any") {
      whereSQL += ` AND (p.local_stock > 0 OR p.has_supplier_stock = 1 OR ${linkStockSubq})`;
    } else if (localStock === "none") {
      whereSQL += ` AND p.local_stock = 0 AND p.has_supplier_stock = 0 AND NOT ${linkStockSubq}`;
    }
    if (hasStock === "true") {
      whereSQL += ` AND (p.local_stock > 0 OR p.has_supplier_stock = 1 OR ${linkStockSubq})`;
    } else if (hasStock === "false") {
      whereSQL += ` AND p.local_stock = 0 AND p.has_supplier_stock = 0 AND NOT ${linkStockSubq}`;
    }
    if (hasPrice === "true") {
      whereSQL += ` AND (p.best_cost_ars IS NOT NULL OR p.own_price_regular IS NOT NULL)`;
    } else if (hasPrice === "false") {
      whereSQL += ` AND p.best_cost_ars IS NULL AND p.own_price_regular IS NULL`;
    }
    if (wooManualPrivate === "1") {
      whereSQL += ` AND p.woo_manual_private = 1`;
    }

    // Count — simple scan, no JOIN needed
    const countResult = db.$client.prepare(
      `SELECT COUNT(*) as cnt FROM products p WHERE 1=1 ${whereSQL}`
    ).get(...whereParams) as { cnt: number };
    const total = countResult?.cnt ?? 0;

    // Data query — uses precomputed best_cost_ars columns, no window function JOIN
    const rawQuery = `
      SELECT
        p.*,
        p.best_cost_ars as best_cost,
        p.best_supplier_code,
        p.best_supplier_name,
        p.best_supplier_stock_qty,
        CASE
          WHEN p.best_cost_ars IS NOT NULL THEN p.best_cost_ars * p.markup_regular
          ELSE NULL
        END as client_price_regular,
        CASE
          WHEN p.best_cost_ars IS NOT NULL AND p.markup_offer IS NOT NULL THEN p.best_cost_ars * p.markup_offer
          ELSE NULL
        END as client_price_offer,
        CASE
          WHEN p.markup_offer IS NOT NULL
            AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
            AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
          THEN 1 ELSE 0
        END as is_on_offer,
        CASE
          WHEN p.own_price_offer IS NOT NULL THEN p.own_price_offer
          WHEN p.own_price_regular IS NOT NULL THEN p.own_price_regular
          WHEN p.best_cost_ars IS NOT NULL AND p.markup_offer IS NOT NULL
            AND p.offer_start IS NOT NULL AND p.offer_end IS NOT NULL
            AND p.offer_start <= datetime('now') AND p.offer_end >= datetime('now')
          THEN p.best_cost_ars * p.markup_offer
          WHEN p.best_cost_ars IS NOT NULL THEN p.best_cost_ars * p.markup_regular
          ELSE NULL
        END as display_price
      FROM products p
      WHERE 1=1 ${whereSQL}
      ORDER BY ${sortColumn} ${sortDirection}
      LIMIT ? OFFSET ?
    `;

    const rows = db.$client.prepare(rawQuery).all(...whereParams, limit, offset) as Array<{
      id: number;
      woocommerce_id: number | null;
      name: string;
      sku: string | null;
      ean_upc: string | null;
      category: string | null;
      brand: string | null;
      warranty: string | null;
      iva_rate: number;
      internal_tax_rate: number;
      markup_regular: number;
      markup_offer: number | null;
      offer_start: string | null;
      offer_end: string | null;
      own_price_regular: number | null;
      own_price_offer: number | null;
      local_stock: number;
      has_supplier_stock: number;
      weight_kg: number | null;
      length_cm: number | null;
      width_cm: number | null;
      height_cm: number | null;
      image_url: string | null;
      slug: string | null;
      store_url: string | null;
      product_tags: string | null;
      attributes: string | null;
      created_at: string;
      updated_at: string;
      best_cost: number | null;
      best_supplier_code: string | null;
      best_supplier_name: string | null;
      best_supplier_stock_qty: number;
      client_price_regular: number | null;
      client_price_offer: number | null;
      is_on_offer: number;
      display_price: number | null;
    }>;

    const productList = rows.map((row) => ({
      id: row.id,
      woocommerceId: row.woocommerce_id,
      name: row.name,
      sku: row.sku,
      eanUpc: row.ean_upc,
      category: row.category,
      brand: row.brand,
      warranty: row.warranty,
      ivaRate: row.iva_rate,
      internalTaxRate: row.internal_tax_rate,
      markupRegular: row.markup_regular,
      markupOffer: row.markup_offer,
      offerStart: row.offer_start,
      offerEnd: row.offer_end,
      ownPriceRegular: row.own_price_regular,
      ownPriceOffer: row.own_price_offer,
      localStock: row.local_stock,
      hasSupplierStock: Boolean(row.has_supplier_stock),
      weightKg: row.weight_kg,
      lengthCm: row.length_cm,
      widthCm: row.width_cm,
      heightCm: row.height_cm,
      imageUrl: row.image_url,
      slug: row.slug,
      storeUrl: row.store_url,
      productTags: row.product_tags,
      attributes: row.attributes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      bestSupplierCost: row.best_cost,
      bestSupplierCode: row.best_supplier_code,
      bestSupplierName: row.best_supplier_name,
      bestSupplierStockQty: row.best_supplier_stock_qty ?? 0,
      clientPrice: row.client_price_regular ? Math.round(row.client_price_regular * 100) / 100 : null,
      clientOfferPrice: row.client_price_offer ? Math.round(row.client_price_offer * 100) / 100 : null,
      isOnOffer: Boolean(row.is_on_offer) || row.own_price_offer !== null,
      displayPrice: row.display_price ? Math.round(row.display_price * 100) / 100 : null,
    }));

    return NextResponse.json({
      products: productList,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/products error:", error);
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const result = db.insert(products).values({
      name: body.name,
      woocommerceId: body.woocommerceId ? parseInt(body.woocommerceId) : null,
      sku: body.sku || null,
      eanUpc: body.eanUpc || null,
      category: body.category || null,
      brand: body.brand || null,
      warranty: body.warranty || null,
      ivaRate: body.ivaRate ?? 0.21,
      internalTaxRate: body.internalTaxRate ?? 0,
      markupRegular: body.markupRegular ?? 1.0,
      localStock: body.localStock ?? 0,
      ownPriceRegular: body.ownPriceRegular || null,
      ownPriceOffer: body.ownPriceOffer || null,
      weightKg: body.weightKg || null,
      lengthCm: body.lengthCm || null,
      widthCm: body.widthCm || null,
      heightCm: body.heightCm || null,
      imageUrl: body.imageUrl || null,
      storeUrl: body.storeUrl || null,
      wooCategoryIds: body.wooCategoryIds || null,
    }).returning().get();

    // Insert initial price history record if product has own price
    if (body.ownPriceRegular) {
      db.insert(productPriceHistory).values({
        productId: result.id,
        priceRegular: body.ownPriceRegular,
        priceOffer: body.ownPriceOffer || null,
      }).run();
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("POST /api/products error:", error);
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
