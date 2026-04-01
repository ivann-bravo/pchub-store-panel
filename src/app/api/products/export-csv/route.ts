import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { roundToNine } from "@/lib/number-format";

export const dynamic = "force-dynamic";

interface ProductRow {
  product_id: number;
  woocommerce_id: number;
  local_stock: number;
  markup_regular: number;
  markup_offer: number | null;
  offer_start: string | null;
  offer_end: string | null;
  own_price_regular: number | null;
  own_price_offer: number | null;
  best_cost_ars: number | null;
  supplier_stock_qty: number | null;
}

interface Snapshot {
  product_id: number;
  stock_qty: number;
  stock_status: string;
  post_status: string;
  regular_price: number | null;
  sale_price: number | null;
  offer_start: string | null;
  offer_end: string | null;
}

interface CsvState {
  stockQty: number;
  stockStatus: string;
  postStatus: string;
  regularPrice: number | null;
  salePrice: number | null;
  offerStart: string;
  offerEnd: string;
}

function computeState(row: ProductRow): CsvState {
  // Stock: local takes priority over supplier
  let stockQty: number;
  let stockStatus: string;
  let postStatus: string;

  if (row.local_stock > 0) {
    stockQty = row.local_stock;
    stockStatus = "featured";
    postStatus = "publish";
  } else if ((row.supplier_stock_qty ?? 0) > 0) {
    stockQty = row.supplier_stock_qty!;
    stockStatus = "instock";
    postStatus = "publish";
  } else {
    stockQty = 0;
    stockStatus = "outofstock";
    postStatus = "private";
  }

  // Prices (ARS, rounded to integer ending in 9)
  let regularPrice: number | null = null;
  let salePrice: number | null = null;

  if (row.own_price_regular != null) {
    regularPrice = roundToNine(row.own_price_regular);
  } else if (row.best_cost_ars != null) {
    regularPrice = roundToNine(row.best_cost_ars * row.markup_regular);
  }

  if (row.own_price_offer != null) {
    salePrice = roundToNine(row.own_price_offer);
  } else if (row.best_cost_ars != null && row.markup_offer != null) {
    salePrice = roundToNine(row.best_cost_ars * row.markup_offer);
  }

  return {
    stockQty,
    stockStatus,
    postStatus,
    regularPrice,
    salePrice,
    offerStart: row.offer_start?.slice(0, 10) ?? "",
    offerEnd: row.offer_end?.slice(0, 10) ?? "",
  };
}

function hasChanged(current: CsvState, snap: Snapshot): boolean {
  return (
    current.stockQty !== snap.stock_qty ||
    current.stockStatus !== snap.stock_status ||
    current.postStatus !== snap.post_status ||
    current.regularPrice !== snap.regular_price ||
    current.salePrice !== snap.sale_price ||
    (current.offerStart || null) !== snap.offer_start ||
    (current.offerEnd || null) !== snap.offer_end
  );
}

/**
 * GET /api/products/export-csv
 *
 * By default exports only products whose state changed since the last export
 * (stock qty, stock status, prices, offer dates). After generating the CSV,
 * updates the snapshots so the next export only picks up new changes.
 *
 * Query params:
 *   full=1          — skip change detection, export everything with a woocommerce_id
 *   categories, brands, suppliers, localStock, search — filter which products to consider
 */
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const fullExport = sp.get("full") === "1";

    const search = sp.get("search") || "";
    const categoriesParam = sp.get("categories") || "";
    const brandsParam = sp.get("brands") || "";
    const suppliersParam = sp.get("suppliers") || "";
    const localStock = sp.get("localStock") || "";

    const categories = categoriesParam ? categoriesParam.split(",").filter(Boolean) : [];
    const brands = brandsParam ? brandsParam.split(",").filter(Boolean) : [];
    const supplierIds = suppliersParam ? suppliersParam.split(",").map(Number).filter(Boolean) : [];

    // Build WHERE fragments
    let whereSQL = `WHERE p.woocommerce_id IS NOT NULL`;
    const whereParams: (string | number)[] = [];

    if (search) {
      whereSQL += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.ean_upc LIKE ?)`;
      const pat = `%${search}%`;
      whereParams.push(pat, pat, pat);
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
      whereSQL += ` AND bp.supplier_code = (SELECT code FROM suppliers WHERE id = ?)`;
      whereParams.push(supplierIds[0]);
    } else if (supplierIds.length > 1) {
      whereSQL += ` AND bp.supplier_code IN (SELECT code FROM suppliers WHERE id IN (${supplierIds.map(() => "?").join(",")}))`;
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

    const sqlite = db.$client;

    // Fetch current product states
    const rows = sqlite.prepare(`
      SELECT
        p.id             AS product_id,
        p.woocommerce_id,
        p.local_stock,
        p.markup_regular,
        p.markup_offer,
        p.offer_start,
        p.offer_end,
        p.own_price_regular,
        p.own_price_offer,
        bp.final_cost_ars    AS best_cost_ars,
        bp.supplier_stock_qty AS supplier_stock_qty
      FROM products p
      LEFT JOIN (
        SELECT
          psl.product_id,
          sp.final_cost_ars,
          psl.supplier_stock_qty,
          ROW_NUMBER() OVER (
            PARTITION BY psl.product_id
            ORDER BY sp.final_cost_ars ASC
          ) AS rn
        FROM product_supplier_links psl
        INNER JOIN supplier_prices sp ON sp.link_id = psl.id
        WHERE psl.is_active = 1 AND psl.supplier_stock_qty > 0
      ) bp ON bp.product_id = p.id AND bp.rn = 1
      ${whereSQL}
      ORDER BY p.name
    `).all(...whereParams) as ProductRow[];

    // Load existing snapshots for these products
    const productIds = rows.map((r) => r.product_id);
    const snapshotMap = new Map<number, Snapshot>();

    if (productIds.length > 0) {
      const placeholders = productIds.map(() => "?").join(",");
      const snaps = sqlite.prepare(
        `SELECT product_id, stock_qty, stock_status, post_status, regular_price, sale_price, offer_start, offer_end
         FROM woo_export_snapshots WHERE product_id IN (${placeholders})`
      ).all(...productIds) as Snapshot[];
      for (const s of snaps) snapshotMap.set(s.product_id, s);
    }

    // Determine which products to include
    const toExport: Array<{ row: ProductRow; state: CsvState }> = [];

    for (const row of rows) {
      const state = computeState(row);
      const snap = snapshotMap.get(row.product_id);

      if (fullExport || !snap || hasChanged(state, snap)) {
        toExport.push({ row, state });
      }
    }

    // Generate CSV
    const headers = [
      "ID",
      "post_status",
      "stock",
      "stock_status",
      "regular_price",
      "sale_price",
      "sale_price_dates_from",
      "sale_price_dates_to",
      "manage_stock",
      "tax:product_visibility",
    ];

    const csvLines: string[] = [headers.join(",")];

    for (const { row, state } of toExport) {
      csvLines.push([
        row.woocommerce_id,
        state.postStatus,
        state.stockQty,
        state.stockStatus,
        state.regularPrice ?? "",
        state.salePrice ?? "",
        state.offerStart,
        state.offerEnd,
        "yes",
        state.stockStatus,
      ].join(","));
    }

    const csv = csvLines.join("\n");

    // Save snapshots for exported products (inside a transaction for speed)
    if (toExport.length > 0) {
      const upsertSnap = sqlite.prepare(`
        INSERT INTO woo_export_snapshots
          (product_id, woocommerce_id, stock_qty, stock_status, post_status, regular_price, sale_price, offer_start, offer_end, exported_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(product_id) DO UPDATE SET
          woocommerce_id = excluded.woocommerce_id,
          stock_qty      = excluded.stock_qty,
          stock_status   = excluded.stock_status,
          post_status    = excluded.post_status,
          regular_price  = excluded.regular_price,
          sale_price     = excluded.sale_price,
          offer_start    = excluded.offer_start,
          offer_end      = excluded.offer_end,
          exported_at    = excluded.exported_at
      `);
      sqlite.transaction(() => {
        for (const { row, state } of toExport) {
          upsertSnap.run(
            row.product_id,
            row.woocommerce_id,
            state.stockQty,
            state.stockStatus,
            state.postStatus,
            state.regularPrice,
            state.salePrice,
            state.offerStart || null,
            state.offerEnd || null
          );
        }
      })();
    }

    const mode = fullExport ? "completo" : "cambios";
    const date = new Date().toISOString().slice(0, 10);
    const filename = `woo-export-${mode}-${date}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Inform the client how many rows were exported
        "X-Export-Count": String(toExport.length),
        "X-Export-Mode": mode,
      },
    });
  } catch (error) {
    console.error("Export CSV error:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
