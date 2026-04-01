import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { wooCategories } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/** GET — list all stored categories */
export async function GET() {
  const rows = await db
    .select()
    .from(wooCategories)
    .orderBy(wooCategories.parentId, wooCategories.name);
  return NextResponse.json(rows);
}

/** POST — save categories fetched client-side from WooCommerce */
export async function POST(request: NextRequest) {
  const body = await request.json() as {
    categories: { id: number; name: string; slug: string; parent: number; count: number }[];
  };

  if (!Array.isArray(body.categories)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  for (const cat of body.categories) {
    await db.run(sql`
      INSERT INTO woo_categories (woo_id, name, slug, parent_id, count, synced_at)
      VALUES (${cat.id}, ${cat.name}, ${cat.slug}, ${cat.parent}, ${cat.count}, datetime('now'))
      ON CONFLICT(woo_id) DO UPDATE SET
        name = excluded.name,
        slug = excluded.slug,
        parent_id = excluded.parent_id,
        count = excluded.count,
        synced_at = excluded.synced_at
    `);
  }

  // Remove categories no longer in WooCommerce
  if (body.categories.length > 0) {
    const ids = body.categories.map((c) => c.id);
    await db.run(sql`
      DELETE FROM woo_categories WHERE woo_id NOT IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `);
  }

  return NextResponse.json({ saved: body.categories.length });
}
