import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products, wooAttributeMappings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

interface WcImage { src: string }
interface WcCategory { id: number; name: string; slug: string }
interface WcAttribute { id: number; name: string; options: string[] }
interface WcProduct {
  sku?: string;
  permalink?: string;
  images?: WcImage[];
  categories?: WcCategory[];
  attributes?: WcAttribute[];
}

/**
 * POST /api/woocommerce/import-product/[id]
 * Receives a WooCommerce product object (fetched browser-side) and updates
 * the panel product with: categories, attributes (via mappings), brand,
 * warranty, and images. IVA is NOT imported (panel is source of truth for IVA).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const productId = parseInt(params.id, 10);
  if (isNaN(productId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const wcProduct = await request.json() as WcProduct;

  const [existing] = await db.select().from(products).where(eq(products.id, productId));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mappings = await db.select().from(wooAttributeMappings);

  // Parse existing attributes JSON
  let attrs: Record<string, unknown> = {};
  try { attrs = JSON.parse(existing.attributes ?? "{}"); } catch {}

  // Build update
  const update: Partial<typeof products.$inferInsert> = {
    wooLastSyncedAt: new Date().toISOString(),
  };

  // SKU
  if (wcProduct.sku) update.sku = wcProduct.sku;

  // Store URL (permalink)
  if (wcProduct.permalink) update.storeUrl = wcProduct.permalink;

  // Images: first = imageUrl, rest = galleryImages
  if (wcProduct.images && wcProduct.images.length > 0) {
    update.imageUrl = wcProduct.images[0].src;
    update.galleryImages = wcProduct.images.length > 1
      ? JSON.stringify(wcProduct.images.slice(1).map((i) => i.src))
      : null;
  }

  // Categories
  if (wcProduct.categories && wcProduct.categories.length > 0) {
    update.wooCategoryIds = JSON.stringify(wcProduct.categories.map((c) => c.id));
  }

  // Attributes (reverse-map wooAttributeId → panelKey, fallback by name for id=0 custom attrs)
  for (const wcAttr of (wcProduct.attributes ?? [])) {
    const mapping = mappings.find((m) => m.wooAttributeId === wcAttr.id)
      ?? mappings.find((m) => m.wooAttributeName.toLowerCase() === wcAttr.name.toLowerCase());
    if (!mapping || !wcAttr.options[0]) continue;
    const value = wcAttr.options[0];

    if (mapping.panelKey === "brand") {
      update.brand = value;
    } else if (mapping.panelKey === "warranty") {
      update.warranty = value;
    } else if (mapping.panelKey === "iva") {
      // IVA is panel → WC, skip
    } else {
      // Boolean attributes: convert "sí"/"no" to true/false
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

  return NextResponse.json({ ok: true });
}
