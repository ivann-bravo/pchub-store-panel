import { NextResponse } from "next/server";
import { fetchAllAttributes } from "@/lib/woocommerce";

/** GET — fetch attributes directly from WooCommerce (not cached) */
export async function GET() {
  try {
    const attributes = await fetchAllAttributes();
    return NextResponse.json(attributes);
  } catch (err) {
    console.error("[woocommerce/attributes] error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
