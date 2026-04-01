import { renderToBuffer } from "@react-pdf/renderer";
import React from "react";
import https from "node:https";
import http from "node:http";
import type { IncomingMessage } from "node:http";
import sharp from "sharp";
import { QuoteDocument, type PdfCompanyInfo, type PdfQuote } from "./quote-pdf";
import { db } from "@/lib/db";
import { quotes, quoteItems, settings } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";

function getSetting(key: string): string {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return "";
  try { return JSON.parse(row.value) as string; } catch { return row.value; }
}

/** Downloads a URL using Node native http/https, follows redirects. */
function downloadBuffer(url: string, redirects = 0): Promise<Buffer | null> {
  return new Promise((resolve) => {
    if (redirects > 5) { resolve(null); return; }
    try {
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, (res: IncomingMessage) => {
        if ([301, 302, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : new URL(res.headers.location, url).href;
          res.resume();
          resolve(downloadBuffer(next, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", () => resolve(null));
      });
      req.setTimeout(8000, () => { req.destroy(); resolve(null); });
      req.on("error", () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * Downloads an image and converts it to a JPEG base64 data URI.
 * This handles WebP (not supported by PDFKit/react-pdf) and any other format.
 */
async function imageToJpegDataUri(url: string): Promise<string | null> {
  try {
    const buf = await downloadBuffer(url);
    if (!buf) return null;
    // Convert to JPEG via sharp — handles WebP, PNG, etc.
    const jpeg = await sharp(buf)
      .resize(120, 120, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 85 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Generate a PDF Buffer for one or more quotes within a session.
 * @param quoteIdOrIds  A single quote id or array of quote ids to include.
 */
export async function generateQuotePdf(quoteIdOrIds: number | number[]): Promise<Buffer> {
  const ids = Array.isArray(quoteIdOrIds) ? quoteIdOrIds : [quoteIdOrIds];

  const company: PdfCompanyInfo = {
    razonSocial: getSetting("company_razon_social") || "PCHub Argentina",
    cuit: getSetting("company_cuit") || "-",
    domicilio: getSetting("company_domicilio") || "-",
    ivaCondition: getSetting("company_iva_condition") || "-",
    ingresosBrutos: getSetting("company_ingresos_brutos") || "-",
    inicioActividades: getSetting("company_inicio_actividades") || "-",
    logoUrl: getSetting("company_logo_url") || null,
  };

  let exchangeRate: number | null = null;
  try { exchangeRate = getEffectiveExchangeRate(); } catch { /* ignore */ }

  const pdfQuotes: PdfQuote[] = [];

  for (const qId of ids) {
    const quote = db.select().from(quotes).where(eq(quotes.id, qId)).get();
    if (!quote) continue;

    const items = db
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, qId))
      .orderBy(asc(quoteItems.sortOrder))
      .all();

    // Convert all product images to JPEG data URIs in parallel (WebP → JPEG via sharp)
    const imageUris = await Promise.all(
      items.map((item) =>
        item.resolvedImageUrl ? imageToJpegDataUri(item.resolvedImageUrl) : Promise.resolve(null)
      )
    );

    pdfQuotes.push({
      id: quote.id,
      title: quote.title,
      notes: quote.notes,
      resolvedTotal: quote.resolvedTotal,
      items: items.map((item, i) => ({
        itemName: item.itemName,
        quantity: item.quantity,
        isOptional: item.isOptional ?? false,
        itemType: item.itemType as "auto" | "fixed" | "text",
        resolvedProductName: item.resolvedProductName,
        resolvedProductSku: item.resolvedProductSku,
        resolvedImageUrl: imageUris[i],
        resolvedPrice: item.resolvedPrice,
        manualPrice: item.manualPrice,
        textPrice: item.textPrice,
        textSku: item.textSku,
      })),
    });
  }

  // Buenos Aires timezone (UTC-3, no DST)
  const emissionDate = new Date().toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const element = React.createElement(QuoteDocument as any, {
    quotes: pdfQuotes,
    company,
    emissionDate,
    exchangeRate,
  }) as import("react").ReactElement<import("@react-pdf/renderer").DocumentProps>;
  const buffer = await renderToBuffer(element);

  return Buffer.from(buffer);
}
