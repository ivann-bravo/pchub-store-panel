import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { appendWcAuth, buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

/**
 * GET /api/woocommerce/test-connection
 * Makes a server-to-server request to WooCommerce to verify connectivity.
 * Uses env vars (never exposed to client). Returns latency + product count.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = getWcBaseUrl();
  if (!url || !process.env.WOO_CONSUMER_KEY) {
    return NextResponse.json({ ok: false, error: "WooCommerce env vars not configured" });
  }

  // Use query param auth (same as browser) to bypass LiteSpeed Cache.
  // LiteSpeed caches "clean" URLs; adding credentials as query params guarantees a cache miss.
  const endpoint = appendWcAuth(`${url}/wp-json/wc/v3/products?per_page=1`);

  const start = Date.now();
  try {
    const res = await fetch(endpoint, {
      headers: buildWcHeaders(),
      redirect: "manual", // don't follow redirects — detect Wordfence "redirect to home" blocking
      signal: AbortSignal.timeout(10_000),
    });

    const latencyMs = Date.now() - start;
    // Detect redirect (Wordfence blocks IPs by redirecting to home page → 301/302)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location") ?? "(desconocido)";
      return NextResponse.json({
        ok: false,
        status: res.status,
        latencyMs,
        serverIp: await getOutboundIp(),
        error: `Wordfence está bloqueando esta IP y redirigiendo a: ${location}. Solución: excluir /wp-json/wc/v3/ del bloqueo por IP en Wordfence → Firewall → All Firewall Options → Whitelisted URLs.`,
      });
    }

    const contentType = res.headers.get("content-type") ?? "";
    const rawBody = await res.text();

    // If response is not JSON (e.g. Wordfence block page, login page, LiteSpeed HTML)
    if (!contentType.includes("application/json")) {
      return NextResponse.json({
        ok: false,
        status: res.status,
        latencyMs,
        serverIp: await getOutboundIp(),
        error: `WooCommerce devolvió ${contentType || "sin content-type"} (HTTP ${res.status}) — esperaba JSON`,
        body: rawBody.slice(0, 300),
      });
    }

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        status: res.status,
        latencyMs,
        serverIp: await getOutboundIp(),
        error: `WooCommerce respondió HTTP ${res.status}`,
        body: rawBody.slice(0, 300),
      });
    }

    let productCount: number | null = null;
    try {
      const data = JSON.parse(rawBody) as unknown[];
      if (Array.isArray(data)) productCount = data.length;
    } catch { /* ignore */ }

    return NextResponse.json({
      ok: true,
      latencyMs,
      productCount,
      serverIp: await getOutboundIp(),
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, latencyMs, error: msg, serverIp: await getOutboundIp() });
  }
}

async function getOutboundIp(): Promise<string | null> {
  try {
    const res = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
    const d = await res.json() as { ip: string };
    return d.ip;
  } catch {
    return null;
  }
}
