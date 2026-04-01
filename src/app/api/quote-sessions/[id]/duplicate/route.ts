import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quoteSessions, quotes, quoteItems } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// POST /api/quote-sessions/[id]/duplicate
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const original = db.select().from(quoteSessions).where(eq(quoteSessions.id, id)).get();
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let exchangeRate: number | null = null;
  try {
    const rate = await getEffectiveExchangeRate();
    exchangeRate = rate ?? null;
  } catch { /* non-fatal */ }

  const newSession = db.insert(quoteSessions).values({
    clientName: `${original.clientName} (copia)`,
    clientPhone: original.clientPhone,
    clientEmail: original.clientEmail,
    notes: original.notes,
    status: "open",
    exchangeRateAtCreation: exchangeRate,
  }).returning().get();

  const originalQuotes = db
    .select()
    .from(quotes)
    .where(eq(quotes.sessionId, id))
    .orderBy(asc(quotes.sortOrder))
    .all();

  for (const q of originalQuotes) {
    const newQuote = db.insert(quotes).values({
      sessionId: newSession.id,
      title: q.title,
      sortOrder: q.sortOrder,
      notes: q.notes,
    }).returning().get();

    const originalItems = db
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, q.id))
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
  }

  return NextResponse.json(newSession, { status: 201 });
}
