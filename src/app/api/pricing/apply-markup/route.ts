import { NextResponse } from "next/server";
import { applyGlobalMarkup, runOfferDetection } from "@/lib/pricing-engine";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";

/**
 * POST /api/pricing/apply-markup
 * Applies global markup to all eligible products, then runs offer detection,
 * refreshes combos, and refreshes the buscador.
 */
export async function POST() {
  try {
    const markupResult = applyGlobalMarkup();
    const offerResult = runOfferDetection();
    try { refreshAllCombos(); } catch {}
    try { refreshAllBuscador(); } catch {}

    return NextResponse.json({
      success: true,
      markup: markupResult,
      offers: offerResult,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/pricing/apply-markup error:", error);
    return NextResponse.json(
      { error: "Apply markup failed: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
