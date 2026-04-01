import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dismissedMatches } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

// POST: Dismiss a match or create action
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const body = await request.json();
    const { supplierCode, dismissType } = body as {
      supplierCode: string;
      dismissType: "match" | "create";
    };

    if (!supplierCode || !dismissType) {
      return NextResponse.json(
        { error: "supplierCode and dismissType are required" },
        { status: 400 }
      );
    }

    // Upsert: insert or ignore if already dismissed
    db.insert(dismissedMatches)
      .values({
        supplierId,
        supplierCode,
        dismissType,
      })
      .onConflictDoNothing()
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Dismiss error:", error);
    return NextResponse.json(
      { error: "Failed to dismiss" },
      { status: 500 }
    );
  }
}

// DELETE: Undo a dismiss
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supplierId = parseInt(params.id);
    const url = new URL(request.url);
    const supplierCode = url.searchParams.get("supplierCode");
    const dismissType = url.searchParams.get("dismissType");

    if (!supplierCode || !dismissType) {
      return NextResponse.json(
        { error: "supplierCode and dismissType are required" },
        { status: 400 }
      );
    }

    db.delete(dismissedMatches)
      .where(
        and(
          eq(dismissedMatches.supplierId, supplierId),
          eq(dismissedMatches.supplierCode, supplierCode),
          eq(dismissedMatches.dismissType, dismissType as "match" | "create")
        )
      )
      .run();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Undismiss error:", error);
    return NextResponse.json(
      { error: "Failed to undismiss" },
      { status: 500 }
    );
  }
}
