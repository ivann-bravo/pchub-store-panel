import { NextResponse } from "next/server";
import { DEMO_MODE } from "@/lib/demo";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { syncSupplier, refreshExchangeRate, recalculateAllSupplierPrices } from "@/lib/sync";
import { syncPolytechSupplier } from "@/lib/sync-polytech";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";

interface SyncResultEntry {
  supplierId: number;
  name: string;
  success: boolean;
  items?: number;
  linked?: number;
  error?: string;
}

interface SyncState {
  running: boolean;
  startedAt?: string;
  syncedAt?: string;
  exchangeRate?: number | null;
  results?: SyncResultEntry[];
  error?: string;
}

// Module-level state — persists across requests within the same server process.
// This is safe for a single-instance Next.js server (local admin panel use case).
let syncState: SyncState = { running: false };

async function runAllSync() {
  try {
    const exchangeRate = await refreshExchangeRate();
    try { recalculateAllSupplierPrices(); } catch {}

    const apiSuppliers = db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.connectorType, "api"), eq(suppliers.autoSync, true)))
      .all()
      .filter((s) => s.apiConfig !== null);

    const results: SyncResultEntry[] = [];

    for (const supplier of apiSuppliers) {
      try {
        const apiConfig = JSON.parse(supplier.apiConfig!);
        const isPolytech = apiConfig.connectorId === "polytech";

        const result = isPolytech
          ? await syncPolytechSupplier(supplier.id)
          : await syncSupplier(supplier.id);

        results.push({
          supplierId: supplier.id,
          name: supplier.name,
          success: true,
          items: result.totalItems,
          linked: result.linkedCount,
        });
      } catch (err) {
        results.push({
          supplierId: supplier.id,
          name: supplier.name,
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    if (results.some((r) => r.success)) {
      try { runOfferDetection(); } catch {}
      try { refreshAllCombos(); } catch {}
      try { refreshAllBuscador(); } catch {}
    }

    syncState = {
      running: false,
      syncedAt: new Date().toISOString(),
      exchangeRate,
      results,
    };
  } catch (error) {
    syncState = {
      running: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// POST — starts the sync and returns immediately.
// The actual sync work runs in the background without blocking the response.
export async function POST() {
  if (DEMO_MODE) {
    return NextResponse.json({ running: false, demo: true });
  }
  if (syncState.running) {
    return NextResponse.json({ running: true, startedAt: syncState.startedAt });
  }

  syncState = { running: true, startedAt: new Date().toISOString() };

  // Fire without awaiting — the event loop continues handling other requests
  // while the sync runs in the background (yielding between batches via setImmediate).
  void runAllSync();

  return NextResponse.json({ started: true });
}

// GET — returns current sync state for polling.
export async function GET() {
  return NextResponse.json(syncState);
}
