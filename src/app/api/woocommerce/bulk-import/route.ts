import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WOO_MSG } from "@/lib/demo";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products, wooAttributeMappings } from "@/lib/db/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { appendWcAuth, buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

interface WcImage { src: string }
interface WcCategory { id: number }
interface WcAttribute { id: number; name: string; options: string[] }
interface WcProduct {
  sku?: string;
  permalink?: string;
  images?: WcImage[];
  categories?: WcCategory[];
  attributes?: WcAttribute[];
}

/**
 * GET /api/woocommerce/bulk-import
 * Returns how many products have a woocommerceId (candidates for import).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products)
    .where(isNotNull(products.woocommerceId));

  const [{ pending }] = await db
    .select({ pending: sql<number>`COUNT(*)` })
    .from(products)
    .where(and(isNotNull(products.woocommerceId), isNull(products.wooLastSyncedAt)));

  return NextResponse.json({ total, pending });
}

/**
 * POST /api/woocommerce/bulk-import
 * Body: { offset?: number, limit?: number }
 * Processes products with woocommerceId in batches, fetching from WC server-to-server.
 * Returns: { processed, total, errors, nextOffset }
 * Call repeatedly (incrementing offset) until nextOffset is null.
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_WOO_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseUrl = getWcBaseUrl();
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY) {
    return NextResponse.json({ error: "WooCommerce env vars not configured" }, { status: 400 });
  }

  const body = await request.json() as { offset?: number; limit?: number; onlyPending?: boolean };
  const offset = body.offset ?? 0;
  const limit = Math.min(body.limit ?? 30, 50);
  const onlyPending = body.onlyPending ?? false;

  const whereClause = onlyPending
    ? and(isNotNull(products.woocommerceId), isNull(products.wooLastSyncedAt))
    : isNotNull(products.woocommerceId);

  const mappings = await db.select().from(wooAttributeMappings);

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products)
    .where(whereClause);

  const batch = await db
    .select()
    .from(products)
    .where(whereClause)
    .limit(limit)
    .offset(offset);

  let processed = 0;
  const errors: { id: number; name: string; error: string }[] = [];

  // Process concurrently in groups of 10 to avoid overwhelming the WC server
  const CONCURRENCY = 10;
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (product) => {
      try {
        const res = await fetch(appendWcAuth(`${baseUrl}/wp-json/wc/v3/products/${product.woocommerceId}`), {
          headers: buildWcHeaders(),
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          errors.push({ id: product.id, name: product.name, error: `HTTP ${res.status}` });
          return;
        }

        const wc = await res.json() as WcProduct;
        await applyImport(product.id, wc, mappings);
        processed++;
      } catch (err) {
        errors.push({ id: product.id, name: product.name, error: String(err) });
      }
    }));
  }

  const nextOffset = offset + batch.length < total ? offset + batch.length : null;

  return NextResponse.json({ processed, total, errors, nextOffset, offset });
}

type MappingRow = { panelKey: string; wooAttributeId: number; wooAttributeName: string; wooAttributeSlug: string };

async function applyImport(productId: number, wc: WcProduct, mappings: MappingRow[]) {
  const [existing] = await db.select({ attributes: products.attributes }).from(products).where(eq(products.id, productId));
  if (!existing) return;

  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(existing.attributes ?? "{}"); } catch {}

  const update: Partial<typeof products.$inferInsert> = {
    wooLastSyncedAt: new Date().toISOString(),
  };

  if (wc.sku) update.sku = wc.sku;
  if (wc.permalink) update.storeUrl = wc.permalink;

  if (wc.images && wc.images.length > 0) {
    update.imageUrl = wc.images[0].src;
    update.galleryImages = wc.images.length > 1
      ? JSON.stringify(wc.images.slice(1).map((i) => i.src))
      : null;
  }

  if (wc.categories && wc.categories.length > 0) {
    update.wooCategoryIds = JSON.stringify(wc.categories.map((c) => c.id));
  }

  for (const wcAttr of (wc.attributes ?? [])) {
    const mapping = mappings.find((m) => m.wooAttributeId === wcAttr.id)
      ?? mappings.find((m) => m.wooAttributeName.toLowerCase() === wcAttr.name.toLowerCase());
    if (!mapping || !wcAttr.options[0]) continue;
    const value = wcAttr.options[0];

    if (mapping.panelKey === "brand") {
      update.brand = value;
    } else if (mapping.panelKey === "warranty") {
      update.warranty = value;
    } else if (mapping.panelKey === "iva") {
      // IVA is panel → WC only, skip
    } else {
      const booleanKeys = new Set(["gpuIntegrado", "coolerStock", "modular"]);
      if (booleanKeys.has(mapping.panelKey)) {
        const lower = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        attrs[mapping.panelKey] = lower === "si" || lower === "yes" || lower === "true";
      } else {
        attrs[mapping.panelKey] = value;
      }
    }
  }

  update.attributes = JSON.stringify(attrs);
  await db.update(products).set(update).where(eq(products.id, productId));
}
