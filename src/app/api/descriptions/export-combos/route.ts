import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { db } from "@/lib/db";
import { comboTemplates } from "@/lib/db/schema";
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
  const sinceNormalized = since
    ? new Date(since).toISOString().replace("T", " ").slice(0, 19)
    : null;

  const where = sinceNormalized
    ? and(isNotNull(comboTemplates.description), gte(comboTemplates.updatedAt, sinceNormalized))
    : isNotNull(comboTemplates.description);

  const rows = db
    .select({
      id: comboTemplates.id,
      sku: comboTemplates.sku,
      name: comboTemplates.name,
      description: comboTemplates.description,
      updatedAt: comboTemplates.updatedAt,
    })
    .from(comboTemplates)
    .where(where)
    .all();

  const date = new Date().toISOString().slice(0, 10);
  const filename = sinceNormalized
    ? `descriptions-combos-novedades-${date}.csv`
    : `descriptions-combos-${date}.csv`;

  const lines = [
    "id,sku,name,description,updated_at",
    ...rows.map((r) =>
      [
        escapeCsvField(String(r.id)),
        escapeCsvField(r.sku),
        escapeCsvField(r.name),
        escapeCsvField(r.description),
        escapeCsvField(r.updatedAt),
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
