import { db } from "./db";
import { exchangeRates, settings } from "./db/schema";
import { desc, eq } from "drizzle-orm";
import { DEMO_MODE } from "./demo";

export interface ExchangeRateData {
  buyRate: number;
  sellRate: number;
  fetchedAt: string;
  source: string;
}

/**
 * Synchronous: returns the active exchange rate (override takes precedence over fetched rate).
 * Used by import routes and sync jobs that run in synchronous DB contexts.
 */
export function getEffectiveExchangeRate(): number | null {
  const override = db.select().from(settings).where(eq(settings.key, "exchange_rate_override")).get();
  if (override) {
    try {
      const parsed = JSON.parse(override.value);
      if (typeof parsed.rate === "number" && parsed.rate > 0) return parsed.rate;
    } catch { /* ignore malformed override */ }
  }
  const latest = db.select().from(exchangeRates).orderBy(desc(exchangeRates.fetchedAt)).limit(1).get();
  return latest?.sellRate ?? null;
}

export async function getLatestExchangeRate(): Promise<ExchangeRateData | null> {
  const rate = db
    .select()
    .from(exchangeRates)
    .orderBy(desc(exchangeRates.fetchedAt))
    .limit(1)
    .get();

  return rate ?? null;
}

export async function fetchAndStoreExchangeRate(): Promise<ExchangeRateData> {
  if (DEMO_MODE) {
    return { source: "oficial", buyRate: 1200, sellRate: 1250, fetchedAt: new Date().toISOString() };
  }

  const response = await fetch("https://dolarapi.com/v1/dolares/oficial", {
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch exchange rate: ${response.status}`);
  }

  const data = await response.json();
  const rate = {
    source: "oficial" as const,
    buyRate: data.compra,
    sellRate: data.venta,
    fetchedAt: new Date().toISOString(),
  };

  db.insert(exchangeRates)
    .values(rate)
    .run();

  return rate;
}
