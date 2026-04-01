import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { isNotNull, and, gte } from "drizzle-orm";

function escapeCsvField(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes('"') || str.includes(",") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  // Normalize ISO datetime to SQLite format: "2024-01-15 10:30:00"
  const sinceNormalized = since
    ? new Date(since).toISOString().replace("T", " ").slice(0, 19)
    : null;

  const where = sinceNormalized
    ? and(isNotNull(products.description), gte(products.updatedAt, sinceNormalized))
    : isNotNull(products.description);

  const rows = db
    .select({
      woocommerceId: products.woocommerceId,
      name: products.name,
      description: products.description,
    })
    .from(products)
    .where(where)
    .all();

  const date = new Date().toISOString().slice(0, 10);
  const filename = sinceNormalized
    ? `descriptions-productos-novedades-${date}.csv`
    : `descriptions-productos-${date}.csv`;

  const lines = [
    "woocommerce_id,name,description",
    ...rows.map((r) =>
      [
        escapeCsvField(r.woocommerceId != null ? String(r.woocommerceId) : ""),
        escapeCsvField(r.name),
        escapeCsvField(r.description),
      ].join(",")
    ),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
