import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_IMPORT_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import {
  suppliers,
  supplierCatalogs,
  supplierCatalogItems,
  productSupplierLinks,
  supplierPrices,
  priceHistory,
  products,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getEffectiveExchangeRate } from "@/lib/exchange-rate";
import * as XLSX from "xlsx";
import { calculateSupplierCost } from "@/lib/pricing";
import { refreshAllCombos, refreshAllBuscador } from "@/lib/combo-resolver";
import { runOfferDetection } from "@/lib/pricing-engine";

export const maxDuration = 300;

const EXCEL_URL =
  "https://www.gestionresellers.com.ar/extranet/exportar/excel?lbv=";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

type SupplierRow = typeof suppliers.$inferSelect;

// ─── helpers ────────────────────────────────────────────────────────────────

function getPolytechSupplier(): SupplierRow | null {
  return (
    db
      .select()
      .from(suppliers)
      .where(sql`UPPER(${suppliers.code}) = 'POLYTECH'`)
      .limit(1)
      .get() ?? null
  );
}

interface ParsedItem {
  code: string;
  title: string;
  sku: string | null;
  priceWithIva: number;
  precioSinIva: number;
  ivaRate: number;
  stock: number;
  stockAvailable: boolean;
}

/** Normaliza texto: minúsculas + sin tildes para comparar encabezados */
function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/** Encuentra el índice de columna que contenga alguna de las keywords (con normalización) */
function colIdx(headers: string[], keywords: string[]): number {
  const h = headers.map(norm);
  for (const kw of keywords) {
    const i = h.findIndex((hdr) => hdr.includes(kw));
    if (i >= 0) return i;
  }
  return -1;
}

function parseExcelBuffer(buffer: Buffer): {
  items: ParsedItem[];
  errors: string[];
  columnMap: Record<string, number>;
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: "",
  });

  const errors: string[] = [];

  // Buscar fila de encabezado (primera fila que tenga ≥ 3 celdas con texto)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(raw.length, 10); i++) {
    const row = raw[i] as unknown[];
    const nonEmpty = row.filter((c) => String(c ?? "").trim().length > 1);
    if (nonEmpty.length >= 3) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return { items: [], errors: ["No se encontró fila de encabezado"], columnMap: {} };
  }

  const headers = (raw[headerRowIdx] as unknown[]).map((c) => String(c ?? ""));

  // Buscar columna de precio SIN IVA explícitamente (excluye "c/iva" y "con iva")
  // para evitar tomar la columna de precio CON IVA cuando ambas existen
  const priceCol = (() => {
    const h = headers.map(norm);
    // Primero buscar columnas explícitamente sin IVA
    const sinIvaKws = ["precio sin iva", "precio s/iva", "precio neto", "precio dist", "distri s/iva", "neto"];
    for (const kw of sinIvaKws) {
      const i = h.findIndex((hdr) => hdr.includes(kw));
      if (i >= 0) return i;
    }
    // Luego buscar columna genérica "precio" que NO sea "con iva" / "c/iva"
    for (let i = 0; i < h.length; i++) {
      if (
        h[i].includes("precio") &&
        !h[i].includes("con iva") &&
        !h[i].includes("c/iva") &&
        !h[i].includes("final")
      ) {
        return i;
      }
    }
    // Último recurso
    return colIdx(headers, ["price", "pvp"]);
  })();

  const codeCol = colIdx(headers, [
    "cod.int", "codigo int", "cod int", "codigo interno",
    "cod. interno", "codigo", "cod.", "code", "id",
  ]);
  const titleCol = colIdx(headers, [
    "descripcion", "titulo", "nombre", "title", "name", "producto",
  ]);
  const skuCol = colIdx(headers, [
    "cod. fab", "cod fab", "fabricante", "part number", "part no",
    "sku", "codigo fab", "cod fabricante",
  ]);
  const ivaCol = colIdx(headers, ["iva", "% iva", "tasa iva", "vat"]);
  const stockCol = colIdx(headers, [
    "stock", "cantidad", "cant.", "cant ", "disponible", "qty",
  ]);

  const columnMap: Record<string, number> = {
    code: codeCol,
    title: titleCol,
    sku: skuCol,
    price: priceCol,
    iva: ivaCol,
    stock: stockCol,
  };

  if (codeCol === -1) {
    errors.push(`No se encontró columna de código. Encabezados: ${headers.join(" | ")}`);
    return { items: [], errors, columnMap };
  }
  if (priceCol === -1) {
    errors.push(`No se encontró columna de precio. Encabezados: ${headers.join(" | ")}`);
    return { items: [], errors, columnMap };
  }

  const items: ParsedItem[] = [];

  for (let i = headerRowIdx + 1; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    const code = String(row[codeCol] ?? "").trim();
    if (!code) continue;

    // El precio en este Excel ya es sin IVA
    const precioSinIva = parseFloat(
      String(row[priceCol] ?? "0").replace(",", ".")
    );
    if (!precioSinIva || precioSinIva <= 0) continue;

    // IVA: puede venir como 21 (%) o 0.21 (decimal)
    let ivaRate = 0.21;
    if (ivaCol >= 0) {
      const rawIva = parseFloat(String(row[ivaCol] ?? "").replace(",", "."));
      if (!isNaN(rawIva) && rawIva > 0) {
        ivaRate = rawIva > 1 ? rawIva / 100 : rawIva;
      }
    }

    const priceWithIva = precioSinIva * (1 + ivaRate);

    // Stock: "Si"/"Sí" → 10 unidades, "No" → 0, número → valor directo
    let stock = 0;
    if (stockCol >= 0) {
      const rawStock = norm(String(row[stockCol] ?? ""));
      if (rawStock === "si") {
        stock = 10;
      } else {
        const n = parseInt(rawStock);
        if (!isNaN(n)) stock = n;
      }
    }

    const title = titleCol >= 0 ? String(row[titleCol] ?? "").trim() : code;
    const sku = skuCol >= 0 ? String(row[skuCol] ?? "").trim() || null : null;

    items.push({
      code,
      title,
      sku,
      priceWithIva,
      precioSinIva,
      ivaRate,
      stock,
      stockAvailable: stock > 0,
    });
  }

  return { items, errors, columnMap };
}

// ─── Import logic (shared by both endpoints) ────────────────────────────────

function importItems(
  supplier: SupplierRow,
  items: ParsedItem[],
  exchangeRate: number
): {
  total: number;
  linked: number;
  unlinked: number;
  errors: string[];
} {
  const iibbRate = supplier.taxRate || 0;
  const errors: string[] = [];
  let linked = 0;
  let unlinked = 0;

  db.$client.transaction(() => {
    // Cargar todos los links existentes de este proveedor
    const existingLinks = db.$client
      .prepare(
        `SELECT psl.id, psl.supplier_code, psl.product_id,
                p.iva_rate, p.internal_tax_rate
         FROM product_supplier_links psl
         INNER JOIN products p ON p.id = psl.product_id
         WHERE psl.supplier_id = ? AND psl.is_active = 1`
      )
      .all(supplier.id) as {
      id: number;
      supplier_code: string;
      product_id: number;
      iva_rate: number;
      internal_tax_rate: number;
    }[];

    const linkByCode = new Map(existingLinks.map((l) => [l.supplier_code, l]));

    const catalog = db
      .insert(supplierCatalogs)
      .values({
        supplierId: supplier.id,
        filename: `polytech-excel-${new Date().toISOString().slice(0, 10)}`,
        rowCount: items.length,
        status: "processing",
      })
      .returning()
      .get();

    for (const item of items) {
      const link = linkByCode.get(item.code);

      try {
        db.insert(supplierCatalogItems)
          .values({
            catalogId: catalog.id,
            supplierCode: item.code,
            description: item.title,
            price: item.precioSinIva,
            currency: "USD",
            stockAvailable: item.stockAvailable,
            rawData: JSON.stringify({
              ivaRate: item.ivaRate,
              internalTaxRate: 0,
              stockQty: item.stock,
              sku: item.sku || item.code,
              title: item.title,
            }),
            linkedProductId: link?.product_id ?? null,
            matchConfidence: link ? 1.0 : null,
          })
          .run();
      } catch {
        // continuar si hay duplicado
      }

      if (!link) {
        unlinked++;
        continue;
      }

      try {
        db.update(productSupplierLinks)
          .set({ supplierStockQty: item.stock })
          .where(eq(productSupplierLinks.id, link.id))
          .run();

        if (Math.abs(link.iva_rate - item.ivaRate) > 0.001) {
          db.update(products)
            .set({ ivaRate: item.ivaRate, updatedAt: new Date().toISOString() })
            .where(eq(products.id, link.product_id))
            .run();
        }

        const finalCostArs = calculateSupplierCost(
          item.precioSinIva,
          item.ivaRate,
          iibbRate,
          link.internal_tax_rate || 0,
          exchangeRate
        );

        const existingPrice = db
          .select()
          .from(supplierPrices)
          .where(eq(supplierPrices.linkId, link.id))
          .get();

        if (existingPrice) {
          db.insert(priceHistory)
            .values({
              linkId: link.id,
              rawPrice: existingPrice.rawPrice,
              currency: existingPrice.currency,
              exchangeRate: existingPrice.exchangeRate,
              finalCostArs: existingPrice.finalCostArs,
            })
            .run();
          db.update(supplierPrices)
            .set({
              rawPrice: item.precioSinIva,
              currency: "USD",
              exchangeRate,
              finalCostArs,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(supplierPrices.id, existingPrice.id))
            .run();
        } else {
          db.insert(supplierPrices)
            .values({
              linkId: link.id,
              rawPrice: item.precioSinIva,
              currency: "USD",
              exchangeRate,
              finalCostArs,
            })
            .run();
        }

        db.insert(priceHistory)
          .values({
            linkId: link.id,
            rawPrice: item.precioSinIva,
            currency: "USD",
            exchangeRate,
            finalCostArs,
          })
          .run();

        linked++;
      } catch (err) {
        errors.push(
          `${item.code}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    db.update(supplierCatalogs)
      .set({ status: "completed", linkedCount: linked })
      .where(eq(supplierCatalogs.id, catalog.id))
      .run();

    // Zero out stock for links whose code is no longer in this catalog
    db.$client
      .prepare(
        `UPDATE product_supplier_links
         SET supplier_stock_qty = 0
         WHERE supplier_id = ?
           AND supplier_stock_qty > 0
           AND supplier_code NOT IN (
             SELECT supplier_code FROM supplier_catalog_items
             WHERE catalog_id = ? AND supplier_code IS NOT NULL
           )`
      )
      .run(supplier.id, catalog.id);

    // Recompute has_supplier_stock for all products linked to this supplier.
    db.$client
      .prepare(
        `UPDATE products
         SET has_supplier_stock = (
           SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
           FROM product_supplier_links
           WHERE product_id = products.id AND is_active = 1 AND supplier_stock_qty > 0
         )
         WHERE id IN (
           SELECT DISTINCT product_id FROM product_supplier_links WHERE supplier_id = ?
         )`
      )
      .run(supplier.id);
  })();

  return { total: items.length, linked, unlinked, errors };
}

// ─── GET: descarga automática desde Polytech ─────────────────────────────────

export async function GET() {
  try {
    const supplier = getPolytechSupplier();
    if (!supplier?.apiConfig) {
      return NextResponse.json(
        { error: "Proveedor POLYTECH no configurado" },
        { status: 400 }
      );
    }

    const exchangeRate = getEffectiveExchangeRate();
    if (!exchangeRate) {
      return NextResponse.json(
        { error: "No hay tipo de cambio disponible. Configure uno primero." },
        { status: 400 }
      );
    }

    const cfg = JSON.parse(supplier.apiConfig);
    const token = cfg.username || "";

    const downloadUrl = EXCEL_URL + encodeURIComponent(token);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000); // 2 min timeout
    let response: Response;
    try {
      response = await fetch(downloadUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          error: `Polytech devolvió ${response.status}. Descargá el Excel manualmente desde el portal de Polytech y subilo con el botón de abajo.`,
          autoDownloadFailed: true,
        },
        { status: 422 }
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (
      !contentType.includes("spreadsheet") &&
      !contentType.includes("excel") &&
      !contentType.includes("octet-stream") &&
      !contentType.includes("binary")
    ) {
      return NextResponse.json(
        {
          error: `La URL no devolvió un Excel (content-type: ${contentType}). Usá la opción de subir manualmente.`,
          autoDownloadFailed: true,
        },
        { status: 422 }
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const { items, errors: parseErrors, columnMap } = parseExcelBuffer(buffer);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "El Excel no tiene filas válidas", details: parseErrors, columnMap },
        { status: 422 }
      );
    }

    const result = importItems(supplier, items, exchangeRate);
    try { runOfferDetection(); } catch (e) { console.warn("[polytech-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[polytech-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[polytech-import] refreshAllBuscador failed:", e); }
    return NextResponse.json({
      success: true,
      source: "auto",
      exchangeRate,
      ...result,
      parseErrors,
      columnMap,
    });
  } catch (err) {
    console.error("Polytech auto-download error:", err);
    return NextResponse.json(
      { error: "Import failed", autoDownloadFailed: true },
      { status: 500 }
    );
  }
}

// ─── POST: subir Excel manualmente ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_IMPORT_MSG, demo: true });
  }
  try {
    const supplier = getPolytechSupplier();
    if (!supplier) {
      return NextResponse.json(
        { error: "Proveedor POLYTECH no configurado" },
        { status: 400 }
      );
    }

    const exchangeRate = getEffectiveExchangeRate();
    if (!exchangeRate) {
      return NextResponse.json(
        { error: "No hay tipo de cambio disponible. Configure uno primero." },
        { status: 400 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Archivo requerido" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "El archivo excede el límite de 50MB" },
        { status: 413 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const { items, errors: parseErrors, columnMap } = parseExcelBuffer(buffer);

    if (items.length === 0) {
      return NextResponse.json(
        { error: "El archivo no tiene filas válidas", details: parseErrors, columnMap },
        { status: 422 }
      );
    }

    const result = importItems(supplier, items, exchangeRate);
    try { runOfferDetection(); } catch (e) { console.warn("[polytech-import] runOfferDetection failed:", e); }
    try { refreshAllCombos(); } catch (e) { console.warn("[polytech-import] refreshAllCombos failed:", e); }
    try { refreshAllBuscador(); } catch (e) { console.warn("[polytech-import] refreshAllBuscador failed:", e); }
    return NextResponse.json({
      success: true,
      source: "upload",
      exchangeRate,
      ...result,
      parseErrors,
      columnMap,
    });
  } catch (err) {
    console.error("Polytech import error:", err);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
