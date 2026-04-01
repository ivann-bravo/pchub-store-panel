import { NextResponse } from "next/server";

/** Returns whether WooCommerce env vars are configured (no WC API call — done client-side). */
export async function GET() {
  const configured = !!(
    process.env.WOO_URL &&
    process.env.WOO_CONSUMER_KEY &&
    process.env.WOO_CONSUMER_SECRET
  );
  return NextResponse.json({
    configured,
    url: process.env.WOO_URL ?? null,
  });
}
