import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_IMAGE_MSG } from "@/lib/demo";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

interface UploadResult {
  url: string;
  attachmentId: number;
  imageType: "main" | "gallery";
  index?: number;
}

/**
 * Fetches an image binary from imageUrl (Railway can reach supplier CDNs),
 * then POSTs it as multipart/form-data to the WP custom endpoint.
 * WP receives the binary and saves it with wp_handle_upload() — no external download from WP needed.
 */
async function uploadImageToWp(
  wpEndpoint: string,
  imageUrl: string,
  wooProductId: number,
  filename: string,
  alt: string,
  setAsFeatured: boolean,
  headers: Record<string, string>,
): Promise<{ attachmentId: number; src: string }> {
  // Step 1: fetch binary from supplier CDN (Railway can reach these)
  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!imgRes.ok) throw new Error(`No se pudo descargar la imagen: HTTP ${imgRes.status}`);

  const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
  const buffer = await imgRes.arrayBuffer();
  const ext = extFromContentType(contentType);

  // Step 2: build multipart/form-data — WP receives the binary and saves it directly
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: contentType }), `${filename}.${ext}`);
  formData.append("wooProductId", String(wooProductId));
  formData.append("alt", alt);
  formData.append("setAsFeatured", setAsFeatured ? "1" : "0");

  // Step 3: POST multipart to WP (no Content-Type header — fetch sets it with the boundary)
  const res = await fetch(wpEndpoint, {
    method: "POST",
    headers,
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<{ attachmentId: number; src: string }>;
}

/**
 * POST /api/woocommerce/upload-product-image
 * Body: { productId: number }
 * Panel fetches image binary from supplier CDN and sends it as multipart to the WP custom endpoint.
 * WP saves the file with wp_handle_upload() — no external download from WP needed.
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMAGE_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseUrl = getWcBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: "WooCommerce env vars not configured" }, { status: 400 });
  }

  const { productId } = await request.json() as { productId: number };
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!product.woocommerceId) return NextResponse.json({ error: "Product has no woocommerceId" }, { status: 400 });
  if (!product.imageUrl) return NextResponse.json({ error: "Product has no imageUrl" }, { status: 400 });

  const wpEndpoint = `${baseUrl}/wp-json/panel/v1/upload-product-image`;
  const slug = toSlug(product.name);
  // No Content-Type here — fetch sets it automatically with the multipart boundary
  const headers = buildWcHeaders();

  // imageUrl may be comma-separated (entered manually in the product form)
  const allFromImageUrl = product.imageUrl.split(",").map(u => u.trim()).filter(Boolean);
  const mainImageUrl = allFromImageUrl[0];
  const extraFromImageUrl = allFromImageUrl.slice(1);

  // Gallery from DB (JSON array, set via WC import)
  let galleryFromDb: string[] = [];
  if (product.galleryImages) {
    try { galleryFromDb = JSON.parse(product.galleryImages) as string[]; } catch {}
  }

  const galleryUrls = [...extraFromImageUrl, ...galleryFromDb];

  const results: UploadResult[] = [];
  const errors: string[] = [];

  // Upload main image
  try {
    const data = await uploadImageToWp(wpEndpoint, mainImageUrl, product.woocommerceId, slug, product.name, true, headers);
    results.push({ url: data.src, attachmentId: data.attachmentId, imageType: "main" });
  } catch (err) {
    errors.push(`Imagen principal: ${String(err)}`);
  }

  // Upload gallery images
  for (let i = 0; i < galleryUrls.length; i++) {
    try {
      const data = await uploadImageToWp(
        wpEndpoint,
        galleryUrls[i],
        product.woocommerceId,
        `${slug}-${i + 2}`,
        `${product.name} - imagen ${i + 2}`,
        false,
        headers,
      );
      results.push({ url: data.src, attachmentId: data.attachmentId, imageType: "gallery", index: i + 2 });
    } catch (err) {
      errors.push(`Galería ${i + 2}: ${String(err)}`);
    }
  }

  if (results.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  return NextResponse.json({ results, errors });
}
