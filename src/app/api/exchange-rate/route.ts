import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeRates, settings } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { recalculateAllSupplierPrices } from "@/lib/sync";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";

const OVERRIDE_KEY = "exchange_rate_override";
const STALE_MINUTES = 15;

async function fetchFromDolarApi() {
  const response = await fetch("https://dolarapi.com/v1/dolares/oficial");
  if (!response.ok) return null;

  const data = await response.json();
  const { compra, venta, fechaActualizacion } = data;
  if (compra == null || venta == null) return null;

  const result = await db
    .insert(exchangeRates)
    .values({
      source: "oficial",
      buyRate: compra,
      sellRate: venta,
      fetchedAt: sql`(datetime('now'))`,
    })
    .returning();

  return { ...result[0], apiDate: fechaActualizacion };
}

function isRateStale(fetchedAt: string): boolean {
  const fetched = new Date(fetchedAt).getTime();
  const now = Date.now();
  return now - fetched > STALE_MINUTES * 60 * 1000;
}

const RECALC_THRESHOLD = 0.005; // 0.5% change triggers recalculation

function triggerBackgroundRecalc(prevRate: number, newRate: number) {
  const change = Math.abs(newRate - prevRate) / prevRate;
  if (change <= RECALC_THRESHOLD) return;
  console.log(
    `[exchange-rate] Rate changed ${(change * 100).toFixed(2)}% ` +
    `(${prevRate} → ${newRate}), triggering background recalculation`
  );
  setImmediate(() => {
    try { recalculateAllSupplierPrices(); } catch {}
    try { refreshAllCombos(); } catch {}
    try { refreshAllBuscador(); } catch {}
  });
}

export async function GET() {
  try {
    // Check for manual override first
    const override = db.select().from(settings).where(eq(settings.key, OVERRIDE_KEY)).get();
    if (override) {
      const parsed = JSON.parse(override.value);
      return NextResponse.json({
        id: 0,
        source: "manual",
        buyRate: parsed.rate,
        sellRate: parsed.rate,
        fetchedAt: parsed.setAt,
        isOverride: true,
      });
    }

    // Get latest rate from DB
    const [latest] = await db
      .select()
      .from(exchangeRates)
      .orderBy(desc(exchangeRates.fetchedAt))
      .limit(1);

    // Auto-fetch if no rate exists or rate is stale
    if (!latest || isRateStale(latest.fetchedAt)) {
      const freshRate = await fetchFromDolarApi();
      if (freshRate) {
        // Trigger background recalculation if rate changed significantly
        if (latest) {
          triggerBackgroundRecalc(latest.sellRate, freshRate.sellRate);
        }
        return NextResponse.json({ ...freshRate, isOverride: false });
      }
      // If auto-fetch failed but we have an old rate, return it
      if (latest) {
        return NextResponse.json({ ...latest, isOverride: false });
      }
      return NextResponse.json(
        { error: "No exchange rate found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ...latest, isOverride: false });
  } catch (error) {
    console.error("GET /api/exchange-rate error:", error);
    return NextResponse.json(
      { error: "Failed to fetch exchange rate" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await fetchFromDolarApi();
    if (!result) {
      return NextResponse.json(
        { error: "Failed to fetch from dolarapi.com" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ...result,
      isOverride: false,
    });
  } catch (error) {
    console.error("POST /api/exchange-rate error:", error);
    return NextResponse.json(
      { error: "Failed to update exchange rate" },
      { status: 500 }
    );
  }
}

// PUT: Set manual override
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { rate } = body;

    if (rate == null || typeof rate !== "number" || rate <= 0) {
      return NextResponse.json({ error: "rate must be a positive number" }, { status: 400 });
    }

    const value = JSON.stringify({ rate, setAt: new Date().toISOString() });
    const existing = db.select().from(settings).where(eq(settings.key, OVERRIDE_KEY)).get();

    if (existing) {
      await db
        .update(settings)
        .set({ value, updatedAt: sql`(datetime('now'))` })
        .where(eq(settings.key, OVERRIDE_KEY));
    } else {
      await db.insert(settings).values({ key: OVERRIDE_KEY, value });
    }

    // Cascade: recalculate all supplier prices and refresh combos
    try { recalculateAllSupplierPrices(); } catch {}
    try { refreshAllCombos(); } catch {}
    try { refreshAllBuscador(); } catch {}

    return NextResponse.json({
      id: 0,
      source: "manual",
      buyRate: rate,
      sellRate: rate,
      fetchedAt: new Date().toISOString(),
      isOverride: true,
    });
  } catch (error) {
    console.error("PUT /api/exchange-rate error:", error);
    return NextResponse.json({ error: "Failed to set override" }, { status: 500 });
  }
}

// DELETE: Clear manual override
export async function DELETE() {
  try {
    await db.delete(settings).where(eq(settings.key, OVERRIDE_KEY));

    // Cascade: recalculate with the restored market rate
    try { recalculateAllSupplierPrices(); } catch {}
    try { refreshAllCombos(); } catch {}
    try { refreshAllBuscador(); } catch {}

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/exchange-rate error:", error);
    return NextResponse.json({ error: "Failed to clear override" }, { status: 500 });
  }
}
