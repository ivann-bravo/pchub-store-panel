import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { wooSyncBlocked } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * PATCH /api/woocommerce/sync-blocked/[id]
 * Body: { action: 'approve' | 'reject', reviewedBy: string }
 * Updates status, reviewed_at, reviewed_by.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const { action, reviewedBy } = await request.json() as { action: "approve" | "reject"; reviewedBy: string };
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }

  const newStatus = action === "approve" ? "approved" : "rejected";

  const [updated] = await db
    .update(wooSyncBlocked)
    .set({
      status: newStatus,
      reviewedAt: new Date().toISOString(),
      reviewedBy: reviewedBy ?? null,
    })
    .where(eq(wooSyncBlocked.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(updated);
}
