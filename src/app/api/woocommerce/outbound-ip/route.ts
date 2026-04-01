import { NextResponse } from "next/server";

/**
 * Returns the outbound IP of this server (Railway).
 * Use this to whitelist the IP in Wordfence.
 */
export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json() as { ip: string };
    return NextResponse.json({ ip: data.ip });
  } catch {
    return NextResponse.json({ error: "No se pudo obtener la IP" }, { status: 500 });
  }
}
