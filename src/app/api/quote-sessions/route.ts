import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quoteSessions, quotes } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

function authError() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// GET /api/quote-sessions?status=open&needsFollowUp=1
export async function GET(req: NextRequest) {
  if (!await checkAuth()) return authError();

  const url = new URL(req.url);
  const statusFilter = url.searchParams.get("status");
  const needsFollowUp = url.searchParams.get("needsFollowUp") === "1";

  const sessionList = db
    .select()
    .from(quoteSessions)
    .orderBy(desc(quoteSessions.updatedAt))
    .all();

  let filtered = sessionList;

  if (statusFilter) {
    filtered = filtered.filter((s) => s.status === statusFilter);
  }

  if (needsFollowUp) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    filtered = filtered.filter(
      (s) => s.status === "following_up" && s.updatedAt < threeDaysAgo
    );
    return NextResponse.json({ count: filtered.length });
  }

  // Attach quote count per session
  const quoteCountMap: Record<number, number> = {};
  const quoteCounts = db
    .select({ sessionId: quotes.sessionId, cnt: sql<number>`COUNT(*)` })
    .from(quotes)
    .groupBy(quotes.sessionId)
    .all();
  for (const row of quoteCounts) {
    quoteCountMap[row.sessionId] = row.cnt;
  }

  const result = filtered.map((s) => ({
    ...s,
    quoteCount: quoteCountMap[s.id] ?? 0,
  }));

  return NextResponse.json(result);
}

// POST /api/quote-sessions
export async function POST(req: NextRequest) {
  if (!await checkAuth()) return authError();

  const body = await req.json() as {
    clientName: string;
    clientPhone?: string;
    clientEmail?: string;
    notes?: string;
  };

  if (!body.clientName?.trim()) {
    return NextResponse.json({ error: "clientName is required" }, { status: 400 });
  }

  let exchangeRate: number | null = null;
  try {
    const rate = await getEffectiveExchangeRate();
    exchangeRate = rate ?? null;
  } catch { /* non-fatal */ }

  const inserted = db.insert(quoteSessions).values({
    clientName: body.clientName.trim(),
    clientPhone: body.clientPhone?.trim() ?? null,
    clientEmail: body.clientEmail?.trim() ?? null,
    notes: body.notes?.trim() ?? null,
    exchangeRateAtCreation: exchangeRate,
  }).returning().get();

  return NextResponse.json(inserted, { status: 201 });
}
