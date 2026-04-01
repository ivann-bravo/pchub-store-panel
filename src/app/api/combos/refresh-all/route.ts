import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { comboTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { refreshCombo } from "@/lib/combo-resolver";
import type { RefreshAllResult } from "@/types";

export const maxDuration = 300;

export async function POST() {
  const active = db
    .select({ id: comboTemplates.id, sku: comboTemplates.sku })
    .from(comboTemplates)
    .where(eq(comboTemplates.isActive, true))
    .all();

  const results: RefreshAllResult["results"] = [];

  for (const t of active) {
    try {
      const res = refreshCombo(t.id);
      results.push({
        templateId: t.id,
        templateSku: t.sku,
        success: true,
        totalPrice: res.totalPrice,
        hasStock: res.hasStock,
      });
    } catch (err) {
      results.push({
        templateId: t.id,
        templateSku: t.sku,
        success: false,
        error: err instanceof Error ? err.message : "Error desconocido",
      });
    }
  }

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    results,
  } satisfies RefreshAllResult);
}
