import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { wooAttributeMappings } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

/** GET — list all attribute mappings */
export async function GET() {
  const rows = await db.select().from(wooAttributeMappings).orderBy(wooAttributeMappings.panelKey);
  return NextResponse.json(rows);
}

/** POST — save/update attribute mappings (bulk upsert) */
export async function POST(request: NextRequest) {
  const body = await request.json() as {
    mappings: { panelKey: string; wooAttributeId: number; wooAttributeName: string; wooAttributeSlug: string }[];
  };

  if (!Array.isArray(body.mappings)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  for (const m of body.mappings) {
    if (!m.panelKey || !m.wooAttributeId) continue;
    await db.run(sql`
      INSERT INTO woo_attribute_mappings (panel_key, woo_attribute_id, woo_attribute_name, woo_attribute_slug, updated_at)
      VALUES (${m.panelKey}, ${m.wooAttributeId}, ${m.wooAttributeName}, ${m.wooAttributeSlug}, datetime('now'))
      ON CONFLICT(panel_key) DO UPDATE SET
        woo_attribute_id = excluded.woo_attribute_id,
        woo_attribute_name = excluded.woo_attribute_name,
        woo_attribute_slug = excluded.woo_attribute_slug,
        updated_at = excluded.updated_at
    `);
  }

  return NextResponse.json({ saved: body.mappings.length });
}

/** DELETE — remove a specific mapping by panelKey */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const panelKey = searchParams.get("panelKey");
  if (!panelKey) return NextResponse.json({ error: "panelKey required" }, { status: 400 });
  await db.run(sql`DELETE FROM woo_attribute_mappings WHERE panel_key = ${panelKey}`);
  return NextResponse.json({ ok: true });
}
