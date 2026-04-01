import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

// 60-second cache — stale stock changes very slowly
let cachedResult: unknown = null;
let cacheExpiresAt = 0;

export async function GET() {
  try {
    if (cachedResult && Date.now() < cacheExpiresAt) {
      return NextResponse.json(cachedResult);
    }

    const results = db.all<{
      id: number;
      name: string;
      sku: string | null;
      category: string | null;
      brand: string | null;
      updated_at: string;
      months_stale: number;
    }>(sql`
      SELECT p.id, p.name, p.sku, p.category, p.brand, p.updated_at,
        CAST((julianday('now') - julianday(p.updated_at)) / 30 AS INTEGER) as months_stale
      FROM products p
      WHERE p.local_stock = 0 AND p.has_supplier_stock = 0
        AND p.updated_at < datetime('now', '-30 days')
      ORDER BY p.updated_at ASC
      LIMIT 100
    `);

    const alerts = results.map((row) => {
      let severity: "warning" | "danger" | "critical";
      if (row.months_stale >= 6) {
        severity = "critical";
      } else if (row.months_stale >= 3) {
        severity = "danger";
      } else {
        severity = "warning";
      }

      return {
        id: row.id,
        name: row.name,
        sku: row.sku,
        category: row.category,
        brand: row.brand,
        updatedAt: row.updated_at,
        monthsStale: row.months_stale,
        severity,
      };
    });

    cachedResult = alerts;
    cacheExpiresAt = Date.now() + 60_000;

    return NextResponse.json(alerts);
  } catch (error) {
    console.error("Stale stock error:", error);
    return NextResponse.json([], { status: 500 });
  }
}
