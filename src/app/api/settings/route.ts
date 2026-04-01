import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (key) {
      const [row] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key));
      if (!row) {
        return NextResponse.json({ error: "Setting not found" }, { status: 404 });
      }
      return NextResponse.json({ key: row.key, value: JSON.parse(row.value), updatedAt: row.updatedAt });
    }

    const all = await db.select().from(settings);
    return NextResponse.json(
      all.map((s) => ({ key: s.key, value: JSON.parse(s.value), updatedAt: s.updatedAt }))
    );
  } catch (error) {
    console.error("GET /api/settings error:", error);
    return NextResponse.json({ error: "Failed to fetch settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    const valueJson = JSON.stringify(value);
    const existing = db.select().from(settings).where(eq(settings.key, key)).get();

    if (existing) {
      await db
        .update(settings)
        .set({ value: valueJson, updatedAt: sql`(datetime('now'))` })
        .where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value: valueJson });
    }

    return NextResponse.json({ key, value, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("PUT /api/settings error:", error);
    return NextResponse.json({ error: "Failed to update setting" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key");

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    await db.delete(settings).where(eq(settings.key, key));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/settings error:", error);
    return NextResponse.json({ error: "Failed to delete setting" }, { status: 500 });
  }
}
