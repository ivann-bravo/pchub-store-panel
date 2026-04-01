import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotes, quoteItems } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// GET /api/quotes/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const items = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  return NextResponse.json({ ...quote, items });
}

// PATCH /api/quotes/[id] — update quote meta + replace items
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json() as {
    title?: string;
    notes?: string | null;
    items?: Array<{
      id?: number;
      sortOrder: number;
      itemName: string;
      quantity: number;
      isOptional?: boolean;
      itemType: "auto" | "fixed" | "text";
      filterCategory?: string | null;
      filterKeywords?: string | null;
      filterMustKeywords?: string | null;
      filterAttributes?: string | null;
      filterMinPrice?: number | null;
      filterMaxPrice?: number | null;
      fixedProductId?: number | null;
      textPrice?: number | null;
      textSku?: string | null;
      // keep resolution cache if provided
      resolvedProductId?: number | null;
      resolvedProductName?: string | null;
      resolvedProductSku?: string | null;
      resolvedImageUrl?: string | null;
      resolvedPrice?: number | null;
      resolvedHasStock?: boolean | null;
      resolvedAt?: string | null;
      manualPrice?: number | null;
      manualPriceNote?: string | null;
    }>;
  };

  const updateFields: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (body.title !== undefined) updateFields.title = body.title;
  if (body.notes !== undefined) updateFields.notes = body.notes;

  db.update(quotes)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(updateFields as any)
    .where(eq(quotes.id, id))
    .run();

  // Replace all items if provided
  if (body.items !== undefined) {
    db.delete(quoteItems).where(eq(quoteItems.quoteId, id)).run();
    for (const item of body.items) {
      db.insert(quoteItems).values({
        quoteId: id,
        sortOrder: item.sortOrder,
        itemName: item.itemName,
        quantity: item.quantity ?? 1,
        isOptional: item.isOptional ?? false,
        itemType: item.itemType,
        filterCategory: item.filterCategory ?? null,
        filterKeywords: item.filterKeywords ?? null,
        filterMustKeywords: item.filterMustKeywords ?? null,
        filterAttributes: item.filterAttributes ?? null,
        filterMinPrice: item.filterMinPrice ?? null,
        filterMaxPrice: item.filterMaxPrice ?? null,
        fixedProductId: item.fixedProductId ?? null,
        textPrice: item.textPrice ?? null,
        textSku: item.textSku ?? null,
        resolvedProductId: item.resolvedProductId ?? null,
        resolvedProductName: item.resolvedProductName ?? null,
        resolvedProductSku: item.resolvedProductSku ?? null,
        resolvedImageUrl: item.resolvedImageUrl ?? null,
        resolvedPrice: item.resolvedPrice ?? null,
        resolvedHasStock: item.resolvedHasStock ?? null,
        resolvedAt: item.resolvedAt ?? null,
        manualPrice: item.manualPrice ?? null,
        manualPriceNote: item.manualPriceNote ?? null,
      }).run();
    }
  }

  const updatedQuote = db.select().from(quotes).where(eq(quotes.id, id)).get();
  const updatedItems = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  return NextResponse.json({ ...updatedQuote, items: updatedItems });
}

// DELETE /api/quotes/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  db.delete(quotes).where(eq(quotes.id, id)).run();
  return NextResponse.json({ ok: true });
}
