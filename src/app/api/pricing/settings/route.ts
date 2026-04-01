import { NextRequest, NextResponse } from "next/server";
import {
  getPricingSettings,
  savePricingSettings,
  getPricingPreview,
  getOwnStockWithoutPrice,
} from "@/lib/pricing-engine";

export async function GET() {
  try {
    const settings = getPricingSettings();
    const preview = getPricingPreview();
    const stockAlerts = getOwnStockWithoutPrice();
    return NextResponse.json({ ...settings, preview, stockAlerts });
  } catch (error) {
    console.error("GET /api/pricing/settings error:", error);
    return NextResponse.json(
      { error: "Failed to get pricing settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    const partial: Parameters<typeof savePricingSettings>[0] = {};
    if (typeof body.globalMarkup === "number") partial.globalMarkup = body.globalMarkup;
    if (body.offerMode === "normal" || body.offerMode === "event")
      partial.offerMode = body.offerMode;
    if (typeof body.offerGlobalStart === "string")
      partial.offerGlobalStart = body.offerGlobalStart;
    if (typeof body.offerGlobalEnd === "string")
      partial.offerGlobalEnd = body.offerGlobalEnd;

    savePricingSettings(partial);

    const updated = getPricingSettings();
    const preview = getPricingPreview();
    const stockAlerts = getOwnStockWithoutPrice();
    return NextResponse.json({ ...updated, preview, stockAlerts });
  } catch (error) {
    console.error("PATCH /api/pricing/settings error:", error);
    return NextResponse.json(
      { error: "Failed to save pricing settings" },
      { status: 500 }
    );
  }
}
