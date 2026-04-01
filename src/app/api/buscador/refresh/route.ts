import { NextResponse } from "next/server";
import { refreshAllBuscador } from "@/lib/combo-resolver";

// POST /api/buscador/refresh — refresh all buscador item resolutions
export async function POST() {
  try {
    refreshAllBuscador();
    return NextResponse.json({ success: true, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error("POST /api/buscador/refresh error:", error);
    return NextResponse.json({ error: "Error al refrescar buscador" }, { status: 500 });
  }
}
