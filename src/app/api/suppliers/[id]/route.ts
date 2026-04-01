import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id, 10);
    if (isNaN(supplierId)) {
      return NextResponse.json({ error: "Invalid supplier ID" }, { status: 400 });
    }

    const [supplier] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    return NextResponse.json(supplier);
  } catch (error) {
    console.error("GET /api/suppliers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch supplier" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id, 10);
    if (isNaN(supplierId)) {
      return NextResponse.json({ error: "Invalid supplier ID" }, { status: 400 });
    }

    const body = await request.json();

    // Verify the supplier exists
    const [existing] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));

    if (!existing) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Update with allowlist to prevent mass-assignment of sensitive fields (apiConfig, code, etc.)
    const allowed: Record<string, unknown> = {};
    const allowedFields = [
      "name", "taxRate", "currency", "isActive", "notes", "autoSync",
      "shippingSurcharge", "shippingPercent", "columnMapping", "stockConfig", "apiConfig",
    ];
    for (const field of allowedFields) {
      if (field in body) allowed[field] = body[field];
    }

    await db
      .update(suppliers)
      .set({
        ...allowed,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(suppliers.id, supplierId));

    // Return updated supplier
    const [updated] = await db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId));

    return NextResponse.json(updated);
  } catch (error) {
    console.error("PATCH /api/suppliers/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update supplier" },
      { status: 500 }
    );
  }
}
