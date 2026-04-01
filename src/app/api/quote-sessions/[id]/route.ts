import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quoteSessions, quotes, quoteItems } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

function authError() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

// GET /api/quote-sessions/[id] — returns session with all quotes + items
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return authError();

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const session = db.select().from(quoteSessions).where(eq(quoteSessions.id, id)).get();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const quoteList = db
    .select()
    .from(quotes)
    .where(eq(quotes.sessionId, id))
    .orderBy(asc(quotes.sortOrder))
    .all();

  const quoteIds = quoteList.map((q) => q.id);
  // Fetch items per quote individually to avoid complex IN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsByQuote: Record<number, any[]> = {};
  for (const qId of quoteIds) {
    itemsByQuote[qId] = db
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, qId))
      .orderBy(asc(quoteItems.sortOrder))
      .all();
  }

  const quotesWithItems = quoteList.map((q) => ({
    ...q,
    items: itemsByQuote[q.id] ?? [],
  }));

  return NextResponse.json({ ...session, quotes: quotesWithItems });
}

// PATCH /api/quote-sessions/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return authError();

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json() as Partial<{
    clientName: string;
    clientPhone: string | null;
    clientEmail: string | null;
    status: string;
    closedQuoteId: number | null;
    closedNotes: string | null;
    wcOrderId: string | null;
    notes: string | null;
  }>;

  const updateFields: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.clientName !== undefined) updateFields.clientName = body.clientName;
  if (body.clientPhone !== undefined) updateFields.clientPhone = body.clientPhone;
  if (body.clientEmail !== undefined) updateFields.clientEmail = body.clientEmail;
  if (body.status !== undefined) updateFields.status = body.status;
  if (body.closedQuoteId !== undefined) updateFields.closedQuoteId = body.closedQuoteId;
  if (body.closedNotes !== undefined) updateFields.closedNotes = body.closedNotes;
  if (body.wcOrderId !== undefined) updateFields.wcOrderId = body.wcOrderId;
  if (body.notes !== undefined) updateFields.notes = body.notes;

  const updated = db
    .update(quoteSessions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .set(updateFields as any)
    .where(eq(quoteSessions.id, id))
    .returning()
    .get();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

// DELETE /api/quote-sessions/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return authError();

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  db.delete(quoteSessions).where(eq(quoteSessions.id, id)).run();
  return NextResponse.json({ ok: true });
}
