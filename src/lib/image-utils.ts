import sharp from "sharp";
import { buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

// ── Types ──────────────────────────────────────────────────────────────────────

export type ImageAuditStatus = "listo" | "ok" | "needs_conversion" | "bad_quality" | "no_image";

export interface ImageAuditData {
  status: ImageAuditStatus;
  width: number;
  height: number;
  format: string;
  isWebP: boolean;
  hasWhiteBg: boolean;
  checkedAt: string;
  error?: string;
}

export interface UploadResult {
  attachmentId: number;
  src: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const SAMPLE_PX = 20;          // corner sample region size
const WHITE_THRESH = 235;       // R/G/B must be >= this to count as "white"
const ALPHA_THRESH = 25;        // alpha <= this counts as "transparent"
const COVERAGE_THRESH = 0.78;   // 78% of sampled pixels must be white/transparent
const MIN_GOOD_SIZE = 600;      // px — minimum for "ok"

// ── Background detection ───────────────────────────────────────────────────────

async function checkWhiteBackground(
  img: sharp.Sharp,
  width: number,
  height: number,
  hasAlpha: boolean,
): Promise<boolean> {
  const sw = Math.max(1, Math.min(SAMPLE_PX, Math.floor(width / 4)));
  const sh = Math.max(1, Math.min(SAMPLE_PX, Math.floor(height / 4)));

  // 4 corners + 4 edge-centers
  const regions = [
    { left: 0,            top: 0             },
    { left: width - sw,   top: 0             },
    { left: 0,            top: height - sh   },
    { left: width - sw,   top: height - sh   },
    { left: Math.floor((width - sw) / 2), top: 0             },
    { left: Math.floor((width - sw) / 2), top: height - sh   },
    { left: 0,            top: Math.floor((height - sh) / 2) },
    { left: width - sw,   top: Math.floor((height - sh) / 2) },
  ];

  const channels = hasAlpha ? 4 : 3;
  let total = 0;
  let hits = 0;

  for (const region of regions) {
    try {
      const { data } = await img
        .clone()
        .extract({ left: region.left, top: region.top, width: sw, height: sh })
        .raw()
        .toBuffer({ resolveWithObject: true });

      for (let i = 0; i < data.length; i += channels) {
        total++;
        if (hasAlpha && data[i + 3] <= ALPHA_THRESH) {
          hits++;
        } else if (
          data[i] >= WHITE_THRESH &&
          data[i + 1] >= WHITE_THRESH &&
          data[i + 2] >= WHITE_THRESH
        ) {
          hits++;
        }
      }
    } catch {
      // skip region if extract fails (e.g. image smaller than sample)
    }
  }

  return total > 0 && hits / total >= COVERAGE_THRESH;
}

// ── Analyze ────────────────────────────────────────────────────────────────────

export async function analyzeImageUrl(imageUrl: string): Promise<ImageAuditData> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TryHardwarePanel/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const img = sharp(buffer);
    const meta = await img.metadata();

    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const format = meta.format ?? "unknown";
    const isWebP = format === "webp";
    const hasAlpha = meta.hasAlpha ?? false;

    const hasWhiteBg = await checkWhiteBackground(img, width, height, hasAlpha);
    const meetsSize = width >= MIN_GOOD_SIZE && height >= MIN_GOOD_SIZE;

    let status: ImageAuditStatus;
    if (isWebP && meetsSize && hasWhiteBg) {
      status = "ok";
    } else if (meetsSize && hasWhiteBg) {
      status = "needs_conversion"; // good quality but not WebP → auto-convertible
    } else {
      status = "bad_quality"; // bad background and/or too small
    }

    return { status, width, height, format, isWebP, hasWhiteBg, checkedAt };
  } catch (err) {
    return {
      status: "bad_quality",
      width: 0,
      height: 0,
      format: "unknown",
      isWebP: false,
      hasWhiteBg: false,
      checkedAt,
      error: String(err),
    };
  }
}

// ── Convert to WebP ────────────────────────────────────────────────────────────

export async function convertToWebP(
  imageUrl: string,
  minSize = MIN_GOOD_SIZE,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const res = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TryHardwarePanel/1.0)" },
  });
  if (!res.ok) throw new Error(`No se pudo descargar la imagen: HTTP ${res.status}`);

  const src = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  let pipeline = sharp(src);

  // Scale up if smaller than minSize on either dimension
  if (w < minSize || h < minSize) {
    const scale = minSize / Math.min(w, h);
    pipeline = pipeline.resize(
      Math.round(w * scale),
      Math.round(h * scale),
      { kernel: "lanczos3" },
    );
  }

  const webpBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
  const finalMeta = await sharp(webpBuffer).metadata();

  return {
    buffer: webpBuffer,
    width: finalMeta.width ?? 0,
    height: finalMeta.height ?? 0,
  };
}

// ── Upload binary to WP ────────────────────────────────────────────────────────

export async function uploadBinaryToWp(
  buffer: Buffer,
  opts: {
    wooProductId: number;
    filename: string; // without extension — .webp appended automatically
    alt: string;
    setAsFeatured: boolean;
  },
): Promise<UploadResult> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl) throw new Error("WooCommerce env vars not configured");

  const wpEndpoint = `${baseUrl}/wp-json/panel/v1/upload-product-image`;
  const headers = buildWcHeaders(); // X-Panel-Sync-Secret — no Content-Type (FormData sets it)

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: "image/webp" }), `${opts.filename}.webp`);
  formData.append("wooProductId", String(opts.wooProductId));
  formData.append("alt", opts.alt);
  formData.append("setAsFeatured", opts.setAsFeatured ? "1" : "0");

  const res = await fetch(wpEndpoint, {
    method: "POST",
    headers,
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP upload HTTP ${res.status} — ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<UploadResult>;
}

// ── Delete WP attachment ───────────────────────────────────────────────────────

export async function deleteWpAttachment(attachmentId: number): Promise<void> {
  const baseUrl = getWcBaseUrl();
  if (!baseUrl) return;

  const wpEndpoint = `${baseUrl}/wp-json/panel/v1/delete-attachment`;
  const headers = buildWcHeaders({ "Content-Type": "application/json" });

  const res = await fetch(wpEndpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ attachmentId }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WP delete attachment HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
}

// ── Slug helper ────────────────────────────────────────────────────────────────

export function toImageSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
