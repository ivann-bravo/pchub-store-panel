import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotes, quoteItems } from "@/lib/db/schema";
import { eq, asc, max } from "drizzle-orm";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// POST /api/quotes/[id]/duplicate
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const original = db.select().from(quotes).where(eq(quotes.id, id)).get();
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const maxOrderRow = db
    .select({ maxOrder: max(quotes.sortOrder) })
    .from(quotes)
    .where(eq(quotes.sessionId, original.sessionId))
    .get();
  const nextOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

  const newQuote = db.insert(quotes).values({
    sessionId: original.sessionId,
    title: `${original.title} (copia)`,
    sortOrder: nextOrder,
    notes: original.notes,
  }).returning().get();

  const originalItems = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  for (const item of originalItems) {
    db.insert(quoteItems).values({
      quoteId: newQuote.id,
      sortOrder: item.sortOrder,
      itemName: item.itemName,
      quantity: item.quantity,
      isOptional: item.isOptional,
      itemType: item.itemType,
      filterCategory: item.filterCategory,
      filterKeywords: item.filterKeywords,
      filterMustKeywords: item.filterMustKeywords,
      filterAttributes: item.filterAttributes,
      filterMinPrice: item.filterMinPrice,
      filterMaxPrice: item.filterMaxPrice,
      fixedProductId: item.fixedProductId,
      textPrice: item.textPrice,
      textSku: item.textSku,
      // Copy resolved cache too
      resolvedProductId: item.resolvedProductId,
      resolvedProductName: item.resolvedProductName,
      resolvedProductSku: item.resolvedProductSku,
      resolvedImageUrl: item.resolvedImageUrl,
      resolvedPrice: item.resolvedPrice,
      resolvedHasStock: item.resolvedHasStock,
      resolvedAt: item.resolvedAt,
      manualPrice: item.manualPrice,
      manualPriceNote: item.manualPriceNote,
    }).run();
  }

  const newItems = db
    .select()
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, newQuote.id))
    .orderBy(asc(quoteItems.sortOrder))
    .all();

  return NextResponse.json({ ...newQuote, items: newItems }, { status: 201 });
}
