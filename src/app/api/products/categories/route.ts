import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/products/categories
// Returns distinct non-null categories sorted alphabetically with product count
export async function GET() {
  try {
    const rows = db.$client
      .prepare(
        `SELECT category, COUNT(*) as count
         FROM products
         WHERE category IS NOT NULL AND category != ''
         GROUP BY category
         ORDER BY category ASC`
      )
      .all() as { category: string; count: number }[];

    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET /api/products/categories error:", error);
    return NextResponse.json({ error: "Error al obtener categorías" }, { status: 500 });
  }
}
