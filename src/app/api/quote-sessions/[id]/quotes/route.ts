import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quoteSessions, quotes } from "@/lib/db/schema";
import { eq, max } from "drizzle-orm";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// POST /api/quote-sessions/[id]/quotes — add a quote to a session
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sessionId = parseInt(params.id);
  if (isNaN(sessionId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const session = db.select().from(quoteSessions).where(eq(quoteSessions.id, sessionId)).get();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const body = await req.json() as { title?: string; notes?: string };

  const maxOrderRow = db
    .select({ maxOrder: max(quotes.sortOrder) })
    .from(quotes)
    .where(eq(quotes.sessionId, sessionId))
    .get();
  const nextOrder = (maxOrderRow?.maxOrder ?? -1) + 1;

  const quoteCount = db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.sessionId, sessionId))
    .all().length;

  const title = body.title?.trim() || `Opción ${quoteCount + 1}`;

  const inserted = db.insert(quotes).values({
    sessionId,
    title,
    sortOrder: nextOrder,
    notes: body.notes?.trim() ?? null,
  }).returning().get();

  return NextResponse.json(inserted, { status: 201 });
}
