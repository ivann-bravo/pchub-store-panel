import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get("page") || "1");
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const direction = url.searchParams.get("direction") || "all"; // up, down, all
    const search = url.searchParams.get("search") || "";
    const sortBy = url.searchParams.get("sortBy") || "change";
    const sortOrder = url.searchParams.get("sortOrder") || "desc";

    // Build WHERE clauses
    const directionFilter =
      direction === "up"
        ? "AND (curr_price - prev_price) > 0"
        : direction === "down"
        ? "AND (curr_price - prev_price) < 0"
        : "";

    const searchFilter = search
      ? `AND product_name LIKE '%' || ? || '%'`
      : "";

    // Determine ORDER BY
    let orderClause: string;
    switch (sortBy) {
      case "product":
        orderClause = `product_name ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
      case "source":
        orderClause = `source ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
      case "previous":
        orderClause = `previous_price ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
      case "current":
        orderClause = `current_price ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
      case "date":
        orderClause = `recorded_at ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
      case "change":
      default:
        orderClause = `ABS(change_percent) ${sortOrder === "desc" ? "DESC" : "ASC"}`;
        break;
    }

    // Optimized query: baseline uses MAX(id) GROUP BY instead of ROW_NUMBER+ABS(julianday),
    // which allows index usage. Count and data merged into one pass via COUNT(*) OVER().
    const dataSql = `
      WITH supplier_current AS (
        SELECT
          ph.link_id,
          ph.final_cost_ars,
          ph.recorded_at,
          psl.product_id,
          p.name as product_name,
          s.name as supplier_name
        FROM price_history ph
        INNER JOIN product_supplier_links psl ON psl.id = ph.link_id
        INNER JOIN products p ON p.id = psl.product_id
        INNER JOIN suppliers s ON s.id = psl.supplier_id
        WHERE ph.id IN (
          SELECT MAX(id) FROM price_history GROUP BY link_id
        )
      ),
      supplier_baseline AS (
        SELECT ph.link_id, ph.final_cost_ars
        FROM price_history ph
        WHERE ph.id IN (
          SELECT MAX(id) FROM price_history
          WHERE recorded_at <= datetime('now', '-6 days')
          GROUP BY link_id
        )
      ),
      supplier_alerts AS (
        SELECT
          curr.product_id,
          curr.product_name,
          curr.supplier_name as source,
          base.final_cost_ars as previous_price,
          curr.final_cost_ars as current_price,
          curr.final_cost_ars as curr_price,
          base.final_cost_ars as prev_price,
          ROUND((curr.final_cost_ars - base.final_cost_ars) / base.final_cost_ars * 100, 2) as change_percent,
          curr.recorded_at
        FROM supplier_current curr
        INNER JOIN supplier_baseline base ON base.link_id = curr.link_id
        WHERE base.final_cost_ars > 0
          AND ABS((curr.final_cost_ars - base.final_cost_ars) / base.final_cost_ars * 100) > 5
      ),
      own_current AS (
        SELECT
          pph.product_id,
          p.name as product_name,
          pph.price_regular,
          pph.recorded_at
        FROM product_price_history pph
        INNER JOIN products p ON p.id = pph.product_id
        WHERE pph.id IN (
          SELECT MAX(id) FROM product_price_history GROUP BY product_id
        )
      ),
      own_baseline AS (
        SELECT pph.product_id, pph.price_regular
        FROM product_price_history pph
        WHERE pph.id IN (
          SELECT MAX(id) FROM product_price_history
          WHERE recorded_at <= datetime('now', '-6 days')
          GROUP BY product_id
        )
      ),
      own_alerts AS (
        SELECT
          curr.product_id,
          curr.product_name,
          'Precio Propio' as source,
          base.price_regular as previous_price,
          curr.price_regular as current_price,
          curr.price_regular as curr_price,
          base.price_regular as prev_price,
          ROUND((curr.price_regular - base.price_regular) / base.price_regular * 100, 2) as change_percent,
          curr.recorded_at
        FROM own_current curr
        INNER JOIN own_baseline base ON base.product_id = curr.product_id
        WHERE base.price_regular IS NOT NULL AND base.price_regular > 0
          AND curr.price_regular IS NOT NULL
          AND ABS((curr.price_regular - base.price_regular) / base.price_regular * 100) > 5
      ),
      all_alerts AS (
        SELECT * FROM supplier_alerts
        UNION ALL
        SELECT * FROM own_alerts
      )
      SELECT
        product_id, product_name, source, previous_price, current_price, change_percent, recorded_at,
        COUNT(*) OVER() as total_count
      FROM all_alerts
      WHERE 1=1 ${directionFilter} ${searchFilter}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `;

    const dataParams: (string | number)[] = [];
    if (search) dataParams.push(search);
    dataParams.push(limit, (page - 1) * limit);

    const rows = db.$client.prepare(dataSql).all(...dataParams) as Array<{
      product_id: number;
      product_name: string;
      source: string;
      previous_price: number;
      current_price: number;
      change_percent: number;
      recorded_at: string;
      total_count: number;
    }>;

    const total = rows[0]?.total_count ?? 0;

    const alerts = rows.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      source: row.source,
      previousPrice: row.previous_price,
      currentPrice: row.current_price,
      changePercent: row.change_percent,
      recordedAt: row.recorded_at,
    }));

    return NextResponse.json({
      alerts,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("GET /api/price-alerts error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price alerts" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const minPercent = url.searchParams.get("minPercent");
    const maxPercent = url.searchParams.get("maxPercent");
    const direction = url.searchParams.get("direction");

    // If filters are provided, clean alerts that match the filter range
    // by removing all price_history records except the most recent for each link_id
    if (minPercent || maxPercent) {
      const min = minPercent ? parseFloat(minPercent) : 0;
      const max = maxPercent ? parseFloat(maxPercent) : Infinity;
      const maxVal = max === Infinity ? 999999 : max;

      // Use the same CTE logic as GET so we target exactly the same alerts shown on screen:
      // compare current price vs the baseline ~7 days ago (not just consecutive records)
      let dirFilter = "";
      if (direction === "up") dirFilter = "AND (curr.final_cost_ars - base.final_cost_ars) > 0";
      else if (direction === "down") dirFilter = "AND (curr.final_cost_ars - base.final_cost_ars) < 0";

      let dirFilterOwn = "";
      if (direction === "up") dirFilterOwn = "AND (curr.price_regular - base.price_regular) > 0";
      else if (direction === "down") dirFilterOwn = "AND (curr.price_regular - base.price_regular) < 0";

      // --- Supplier alerts (price_history) ---
      const alertLinksSql = `
        WITH supplier_current AS (
          SELECT
            ph.link_id,
            ph.final_cost_ars,
            ROW_NUMBER() OVER (PARTITION BY ph.link_id ORDER BY ph.id DESC) as rn
          FROM price_history ph
        ),
        supplier_baseline AS (
          SELECT
            ph.link_id,
            ph.final_cost_ars,
            ROW_NUMBER() OVER (
              PARTITION BY ph.link_id
              ORDER BY ABS(julianday(ph.recorded_at) - julianday('now', '-7 days'))
            ) as rn
          FROM price_history ph
          WHERE ph.recorded_at <= datetime('now', '-6 days')
        )
        SELECT curr.link_id
        FROM supplier_current curr
        INNER JOIN supplier_baseline base ON base.link_id = curr.link_id AND base.rn = 1
        WHERE curr.rn = 1
          AND base.final_cost_ars > 0
          AND ABS((curr.final_cost_ars - base.final_cost_ars) / base.final_cost_ars * 100) > 5
          AND ABS((curr.final_cost_ars - base.final_cost_ars) / base.final_cost_ars * 100) >= ?
          AND ABS((curr.final_cost_ars - base.final_cost_ars) / base.final_cost_ars * 100) <= ?
          ${dirFilter}
      `;

      const linkIds = db.$client.prepare(alertLinksSql).all(min, maxVal) as { link_id: number }[];

      let totalDeleted = 0;
      for (const { link_id } of linkIds) {
        // Keep only the most recent record (highest id) for this link_id
        const result = db.$client.prepare(`
          DELETE FROM price_history
          WHERE link_id = ? AND id != (SELECT MAX(id) FROM price_history WHERE link_id = ?)
        `).run(link_id, link_id);
        totalDeleted += result.changes || 0;
      }

      // --- Own price alerts (product_price_history / "Precio Propio") ---
      const ownAlertsSql = `
        WITH own_current AS (
          SELECT
            pph.product_id,
            pph.price_regular,
            ROW_NUMBER() OVER (PARTITION BY pph.product_id ORDER BY pph.id DESC) as rn
          FROM product_price_history pph
        ),
        own_baseline AS (
          SELECT
            pph.product_id,
            pph.price_regular,
            ROW_NUMBER() OVER (
              PARTITION BY pph.product_id
              ORDER BY ABS(julianday(pph.recorded_at) - julianday('now', '-7 days'))
            ) as rn
          FROM product_price_history pph
          WHERE pph.recorded_at <= datetime('now', '-6 days')
        )
        SELECT curr.product_id
        FROM own_current curr
        INNER JOIN own_baseline base ON base.product_id = curr.product_id AND base.rn = 1
        WHERE curr.rn = 1
          AND base.price_regular IS NOT NULL AND base.price_regular > 0
          AND curr.price_regular IS NOT NULL
          AND ABS((curr.price_regular - base.price_regular) / base.price_regular * 100) > 5
          AND ABS((curr.price_regular - base.price_regular) / base.price_regular * 100) >= ?
          AND ABS((curr.price_regular - base.price_regular) / base.price_regular * 100) <= ?
          ${dirFilterOwn}
      `;

      const ownProductIds = db.$client.prepare(ownAlertsSql).all(min, maxVal) as { product_id: number }[];

      for (const { product_id } of ownProductIds) {
        const result = db.$client.prepare(`
          DELETE FROM product_price_history
          WHERE product_id = ? AND id != (SELECT MAX(id) FROM product_price_history WHERE product_id = ?)
        `).run(product_id, product_id);
        totalDeleted += result.changes || 0;
      }

      const alertsCleaned = linkIds.length + ownProductIds.length;
      return NextResponse.json({
        deleted: totalDeleted,
        alertsCleaned,
        message: `${alertsCleaned} alertas limpiadas (${totalDeleted} registros eliminados)`,
      });
    }

    // Default: delete price history older than 30 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString();

    const result = db.$client.prepare(
      `DELETE FROM price_history WHERE recorded_at < ?`
    ).run(cutoffStr);

    const result2 = db.$client.prepare(
      `DELETE FROM product_price_history WHERE recorded_at < ?`
    ).run(cutoffStr);

    return NextResponse.json({
      deleted: (result.changes || 0) + (result2.changes || 0),
      message: "Historial anterior a 30 días eliminado",
    });
  } catch (error) {
    console.error("DELETE /api/price-alerts error:", error);
    return NextResponse.json(
      { error: "Failed to clear history" },
      { status: 500 }
    );
  }
}
