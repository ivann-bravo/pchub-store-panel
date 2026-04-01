import { NextResponse } from "next/server";
import { runOfferDetection } from "@/lib/pricing-engine";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";

/**
 * POST /api/pricing/run-offers
 * Runs offer detection, then refreshes combos and buscador.
 */
export async function POST() {
  try {
    const offerResult = runOfferDetection();

    try {
      refreshAllCombos();
    } catch {}
    try { refreshAllBuscador(); } catch {}

    return NextResponse.json({
      success: true,
      offersAdded: offerResult.offersAdded,
      offersRemoved: offerResult.offersRemoved,
      skipped: offerResult.skipped,
      groups: offerResult.groups,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/pricing/run-offers error:", error);
    return NextResponse.json(
      { error: "Offer detection failed: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
