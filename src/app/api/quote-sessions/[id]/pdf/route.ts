import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quoteSessions, quotes } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { generateQuotePdf } from "@/lib/pdf/generate-quote-pdf";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// GET /api/quote-sessions/[id]/pdf — generates PDF with all quotes in the session
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const session = db.select().from(quoteSessions).where(eq(quoteSessions.id, id)).get();
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sessionQuotes = db
    .select({ id: quotes.id })
    .from(quotes)
    .where(eq(quotes.sessionId, id))
    .orderBy(asc(quotes.sortOrder))
    .all();

  if (sessionQuotes.length === 0) {
    return NextResponse.json({ error: "No quotes in session" }, { status: 400 });
  }

  const quoteIds = sessionQuotes.map((q) => q.id);

  try {
    const buffer = await generateQuotePdf(quoteIds);
    const filename = `presupuesto-${session.clientName.replace(/\s+/g, "-")}.pdf`;
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    console.error("[pdf] Error generating session PDF:", e);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
