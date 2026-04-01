import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_SYNC_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { suppliers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getConnector } from "@/lib/connectors";
import { syncSupplier, refreshExchangeRate } from "@/lib/sync";
import { PolytechConnector, POLYTECH_BASE_URL } from "@/lib/connectors/polytech";
import { syncPolytechSupplier } from "@/lib/sync-polytech";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import type { ApiConfig } from "@/types";

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_SYNC_MSG, demo: true });
  }
  try {
    const supplierId = parseInt(params.id);
    const supplier = db
      .select()
      .from(suppliers)
      .where(eq(suppliers.id, supplierId))
      .get();

    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    if (supplier.connectorType !== "api" || !supplier.apiConfig) {
      return NextResponse.json(
        { error: "Supplier is not configured for API sync" },
        { status: 400 }
      );
    }

    const apiConfig: ApiConfig = JSON.parse(supplier.apiConfig);
    const body = await request.json();
    const action: string = body.action;

    // Polytech has a dedicated sync route — proxy to it
    if (apiConfig.connectorId === "polytech") {
      const polytechConnector = new PolytechConnector(
        apiConfig.username || "",
        apiConfig.baseUrl || POLYTECH_BASE_URL
      );

      if (action === "test") {
        try {
          const ok = await polytechConnector.testConnection();
          return NextResponse.json({ success: ok, message: ok ? "Connection OK" : "Connection failed" });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Connection failed";
          return NextResponse.json({ success: false, error: msg });
        }
      }

      if (action === "sync") {
        await refreshExchangeRate();
        const result = await syncPolytechSupplier(supplierId);
        try { refreshAllCombos(); } catch {}
        try { refreshAllBuscador(); } catch {}
        return NextResponse.json(result);
      }
    }

    if (action === "test") {
      try {
        const connector = getConnector(apiConfig.connectorId, apiConfig);
        const ok = await connector.testConnection();
        return NextResponse.json({ success: ok, message: ok ? "Connection OK" : "Connection failed" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connection failed";
        console.error("Test connection error:", msg);
        return NextResponse.json({ success: false, error: msg });
      }
    }

    if (action === "sync") {
      await refreshExchangeRate();
      const result = await syncSupplier(supplierId);
      try { refreshAllCombos(); } catch {}
      try { refreshAllBuscador(); } catch {}
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Invalid action. Use 'test' or 'sync'" }, { status: 400 });
  } catch (error) {
    console.error("Sync error:", error);
    return NextResponse.json(
      { error: "Sync failed: " + (error instanceof Error ? error.message : "Unknown error") },
      { status: 500 }
    );
  }
}
