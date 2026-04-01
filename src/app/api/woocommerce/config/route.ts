import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Returns WooCommerce credentials to authenticated SUPER_ADMIN users.
 * Credentials are used client-side to call WooCommerce directly from the browser,
 * bypassing Railway's IP (which is blocked by Wordfence on Hostinger).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = process.env.WOO_URL?.replace(/\/+$/, "") ?? "";
  const key = process.env.WOO_CONSUMER_KEY ?? "";
  const secret = process.env.WOO_CONSUMER_SECRET ?? "";

  return NextResponse.json({
    configured: !!(url && key && secret),
    url,
    key,
    secret,
  });
}
