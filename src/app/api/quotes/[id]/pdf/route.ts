import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { generateQuotePdf } from "@/lib/pdf/generate-quote-pdf";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

// GET /api/quotes/[id]/pdf
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const buffer = await generateQuotePdf(id);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="presupuesto-${id}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[pdf] Error generating quote PDF:", e);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
