import { NextRequest, NextResponse } from "next/server";
import { refreshCombo } from "@/lib/combo-resolver";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  try {
    const result = refreshCombo(id);
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Combo refresh error [id=${id}]:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error al actualizar combo" },
      { status: 500 }
    );
  }
}
