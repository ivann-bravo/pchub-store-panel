import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildWcHeaders, getWcBaseUrl, appendWcAuth } from "@/lib/woo-sync-utils";

/** Generate optimal SEO alt text from product data. */
function buildAlt(name: string, brand: string | null): string {
  const n = name.trim();
  if (!brand) return n;
  // Skip brand if already present in the name
  return n.toLowerCase().includes(brand.toLowerCase()) ? n : `${n} - ${brand}`;
}

/** Get attachment IDs from WC REST API for a product. */
async function fetchWcImageIds(woocommerceId: number): Promise<number[]> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl) return [];
  try {
    const res = await fetch(
      appendWcAuth(`${baseUrl}/wp-json/wc/v3/products/${woocommerceId}`),
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return [];
    const data = await res.json() as { images?: { id: number }[] };
    return (data.images ?? []).map((img) => img.id).filter(Boolean);
  } catch {
    return [];
  }
}

/** Update WP attachment title and alt via the custom panel endpoint. */
async function updateAttachmentMeta(attachmentId: number, title: string, alt: string): Promise<void> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl) throw new Error("WooCommerce env vars not configured");

  const res = await fetch(`${baseUrl}/wp-json/panel/v1/update-attachment-meta`, {
    method: "POST",
    headers: buildWcHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ attachmentId, title, alt }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
}

/**
 * POST /api/images/update-seo
 * Body: { productId?: number; bulk?: boolean }
 *
 * - productId: update SEO metadata for a single product's WC images
 * - bulk: update all "ok" products with a woocommerceId
 *
 * Updates WP attachment title + alt text to match the panel product name.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { productId, bulk = false } = await request.json() as {
    productId?: number;
    bulk?: boolean;
  };

  if (!bulk && !productId) {
    return NextResponse.json({ error: "productId or bulk required" }, { status: 400 });
  }

  // ── Bulk mode ─────────────────────────────────────────────────────────────────
  if (bulk) {
    const rows = await db
      .select({
        id: products.id,
        name: products.name,
        brand: products.brand,
        woocommerceId: products.woocommerceId,
        wooMainImageAttachmentId: products.wooMainImageAttachmentId,
        wooGalleryAttachmentIds: products.wooGalleryAttachmentIds,
      })
      .from(products)
      .where(sql`image_audit_status = 'ok' AND woocommerce_id IS NOT NULL`);

    let updated = 0;
    const errors: string[] = [];

    for (const row of rows) {
      if (!row.woocommerceId) continue;

      const alt = buildAlt(row.name, row.brand);
      const title = row.name.trim();

      // Collect all attachment IDs for this product
      const attachmentIds: number[] = [];

      if (row.wooMainImageAttachmentId) {
        attachmentIds.push(row.wooMainImageAttachmentId);
      }
      if (row.wooGalleryAttachmentIds) {
        try {
          const ids = JSON.parse(row.wooGalleryAttachmentIds) as number[];
          attachmentIds.push(...ids.filter(Boolean));
        } catch { /* ignore */ }
      }

      // Fall back to WC REST API if no stored IDs
      if (attachmentIds.length === 0) {
        const wcIds = await fetchWcImageIds(row.woocommerceId);
        attachmentIds.push(...wcIds);
      }

      for (const id of attachmentIds) {
        try {
          await updateAttachmentMeta(id, title, alt);
          updated++;
        } catch (err) {
          errors.push(`Producto ${row.id} attachment ${id}: ${String(err)}`);
        }
      }
    }

    return NextResponse.json({ updated, errors, total: rows.length });
  }

  // ── Single product mode ───────────────────────────────────────────────────────
  const [product] = await db.select().from(products).where(eq(products.id, productId!));
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!product.woocommerceId) return NextResponse.json({ error: "No woocommerceId" }, { status: 400 });

  const alt = buildAlt(product.name, product.brand);
  const title = product.name.trim();

  const attachmentIds: number[] = [];
  if (product.wooMainImageAttachmentId) {
    attachmentIds.push(product.wooMainImageAttachmentId);
  }
  if (product.wooGalleryAttachmentIds) {
    try {
      const ids = JSON.parse(product.wooGalleryAttachmentIds) as number[];
      attachmentIds.push(...ids.filter(Boolean));
    } catch { /* ignore */ }
  }
  if (attachmentIds.length === 0) {
    const wcIds = await fetchWcImageIds(product.woocommerceId);
    attachmentIds.push(...wcIds);
  }

  const errors: string[] = [];
  let updated = 0;
  for (const id of attachmentIds) {
    try {
      await updateAttachmentMeta(id, title, alt);
      updated++;
    } catch (err) {
      errors.push(`Attachment ${id}: ${String(err)}`);
    }
  }

  if (updated === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  return NextResponse.json({ updated, errors, title, alt });
}
