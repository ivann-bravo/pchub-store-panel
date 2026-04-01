import { NextResponse } from "next/server";
import { recalculateAllSupplierPrices } from "@/lib/sync";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";
import { db } from "@/lib/db";
import { exchangeRates, settings } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

const OVERRIDE_KEY = "exchange_rate_override";

function getCurrentExchangeRate(): number | null {
  const override = db.select().from(settings).where(eq(settings.key, OVERRIDE_KEY)).get();
  if (override) return JSON.parse(override.value).rate;
  const [latest] = db.select().from(exchangeRates).orderBy(desc(exchangeRates.fetchedAt)).limit(1).all();
  return latest?.sellRate ?? null;
}

export async function POST() {
  try {
    const exchangeRate = getCurrentExchangeRate();
    if (!exchangeRate) {
      return NextResponse.json(
        { error: "No exchange rate available. Please set one first." },
        { status: 400 }
      );
    }

    const updatedCount = recalculateAllSupplierPrices();
    try { runOfferDetection(); } catch {}
    try { refreshAllCombos(); } catch {}
    try { refreshAllBuscador(); } catch {}

    return NextResponse.json({
      success: true,
      updatedCount,
      exchangeRate,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("POST /api/prices/recalculate error:", error);
    return NextResponse.json(
      { error: "Recalculation failed: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
