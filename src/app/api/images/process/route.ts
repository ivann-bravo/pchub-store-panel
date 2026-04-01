import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_IMAGE_MSG } from "@/lib/demo";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  analyzeImageUrl,
  convertToWebP,
  uploadBinaryToWp,
  deleteWpAttachment,
  toImageSlug,
  type ImageAuditData,
} from "@/lib/image-utils";
import { appendWcAuth, getWcBaseUrl } from "@/lib/woo-sync-utils";

/** Fetch current image attachment IDs from WC REST API for this product. */
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

/**
 * POST /api/images/process
 * Converts an image to WebP, uploads it to WP/WC, deletes old attachment, updates DB.
 *
 * Body:
 *   productId: number
 *   target: "main" | "gallery"
 *   galleryIndex?: number   (0-based index in galleryImages array, for target="gallery")
 *   newUrl?: string         (optional: replace with this URL instead of existing one)
 *   forceConvert?: boolean  (process even if background is bad / size is small)
 *   analyzeOnly?: boolean   (analyze newUrl and return audit without processing)
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMAGE_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    productId,
    target = "main",
    galleryIndex = 0,
    newUrl,
    forceConvert = false,
    analyzeOnly = false,
  } = await request.json() as {
    productId: number;
    target?: "main" | "gallery";
    galleryIndex?: number;
    newUrl?: string;
    forceConvert?: boolean;
    analyzeOnly?: boolean;
  };

  if (!productId) return NextResponse.json({ error: "productId required" }, { status: 400 });

  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  if (!product.woocommerceId) return NextResponse.json({ error: "Product has no woocommerceId" }, { status: 400 });

  // ── Determine source URL ─────────────────────────────────────────────────────
  let sourceUrl: string;
  if (newUrl) {
    sourceUrl = newUrl.trim();
  } else if (target === "main") {
    const firstUrl = (product.imageUrl ?? "").split(",")[0].trim();
    if (!firstUrl) return NextResponse.json({ error: "Product has no imageUrl" }, { status: 400 });
    sourceUrl = firstUrl;
  } else {
    // gallery
    const gallery: string[] = product.galleryImages ? JSON.parse(product.galleryImages) : [];
    if (!gallery[galleryIndex]) {
      return NextResponse.json({ error: `Gallery image at index ${galleryIndex} not found` }, { status: 400 });
    }
    sourceUrl = gallery[galleryIndex];
  }

  // ── Analyze-only mode (preview before committing) ────────────────────────────
  if (analyzeOnly) {
    const audit = await analyzeImageUrl(sourceUrl);
    return NextResponse.json({ audit });
  }

  // ── Analyze to decide if processable ────────────────────────────────────────
  const audit = await analyzeImageUrl(sourceUrl);

  if (audit.status === "bad_quality" && !forceConvert && !newUrl) {
    // Don't auto-process bad images without explicit forceConvert or a newUrl
    return NextResponse.json({ error: "bad_quality", audit }, { status: 422 });
  }

  const isMain = target === "main";

  // ── Capture old attachment IDs BEFORE uploading ───────────────────────────────
  // Must happen before upload because the WP snippet calls set_post_thumbnail()
  // immediately, so querying WC after upload would return the new attachment ID.
  const oldGalleryIds: number[] = product.wooGalleryAttachmentIds
    ? JSON.parse(product.wooGalleryAttachmentIds)
    : [];

  let oldAttachmentId: number | null = null;
  if (isMain) {
    // Use stored ID if available, otherwise fetch from WC REST API
    if (product.wooMainImageAttachmentId) {
      oldAttachmentId = product.wooMainImageAttachmentId;
    } else {
      const wcImageIds = await fetchWcImageIds(product.woocommerceId);
      oldAttachmentId = wcImageIds[0] ?? null;
    }
  } else {
    if (oldGalleryIds[galleryIndex]) {
      oldAttachmentId = oldGalleryIds[galleryIndex];
    } else {
      const wcImageIds = await fetchWcImageIds(product.woocommerceId);
      oldAttachmentId = wcImageIds[galleryIndex + 1] ?? null;
    }
  }

  // ── Convert to WebP ──────────────────────────────────────────────────────────
  let buffer: Buffer;
  let finalWidth: number;
  let finalHeight: number;
  try {
    const result = await convertToWebP(sourceUrl);
    buffer = result.buffer;
    finalWidth = result.width;
    finalHeight = result.height;
  } catch (err) {
    return NextResponse.json({ error: `Conversión fallida: ${String(err)}` }, { status: 502 });
  }

  // ── Upload to WP ─────────────────────────────────────────────────────────────
  const slug = toImageSlug(product.name);
  const filename = isMain ? slug : `${slug}-${galleryIndex + 2}`;
  const alt = isMain ? product.name : `${product.name} - imagen ${galleryIndex + 2}`;

  let uploadResult: { attachmentId: number; src: string };
  try {
    uploadResult = await uploadBinaryToWp(buffer, {
      wooProductId: product.woocommerceId,
      filename,
      alt,
      setAsFeatured: isMain,
    });
  } catch (err) {
    return NextResponse.json({ error: `Upload a WP fallido: ${String(err)}` }, { status: 502 });
  }

  // ── Delete old WC attachment ──────────────────────────────────────────────────
  const deleteErrors: string[] = [];
  if (oldAttachmentId && oldAttachmentId !== uploadResult.attachmentId) {
    try {
      await deleteWpAttachment(oldAttachmentId);
    } catch (err) {
      deleteErrors.push(`No se pudo eliminar attachment viejo (${oldAttachmentId}): ${String(err)}`);
    }
  }

  // ── Update panel DB ──────────────────────────────────────────────────────────
  const finalAuditData: ImageAuditData = {
    ...audit,
    width: finalWidth,
    height: finalHeight,
    format: "webp",
    isWebP: true,
    status: "listo",
    checkedAt: new Date().toISOString(),
  };

  if (isMain) {
    await db
      .update(products)
      .set({
        imageUrl: uploadResult.src,
        wooMainImageAttachmentId: uploadResult.attachmentId,
        imageAuditStatus: "listo",
        imageAuditData: JSON.stringify(finalAuditData),
      })
      .where(eq(products.id, productId));
  } else {
    // Update gallery: replace URL and attachment ID at the given index
    const gallery: string[] = product.galleryImages ? JSON.parse(product.galleryImages) : [];
    gallery[galleryIndex] = uploadResult.src;

    const galleryIds: number[] = product.wooGalleryAttachmentIds
      ? JSON.parse(product.wooGalleryAttachmentIds)
      : [];
    galleryIds[galleryIndex] = uploadResult.attachmentId;

    await db
      .update(products)
      .set({
        galleryImages: JSON.stringify(gallery),
        wooGalleryAttachmentIds: JSON.stringify(galleryIds),
      })
      .where(eq(products.id, productId));
  }

  return NextResponse.json({
    success: true,
    newUrl: uploadResult.src,
    attachmentId: uploadResult.attachmentId,
    width: finalWidth,
    height: finalHeight,
    deleteErrors,
    audit: finalAuditData,
  });
}
