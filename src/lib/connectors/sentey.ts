/**
 * Sentey Supplier Connector
 *
 * XLSX Format (sin fila de encabezado — datos comienzan en Excel fila 4 / índice 3):
 * [ignorado | ignorado | ignorado | SKU | Descripción | Precio sin IVA | IVA | ...]
 *
 * Columnas (índice 0-based):
 *   D (3): Código / SKU — usado para vincular al catálogo
 *   E (4): Descripción del producto
 *   F (5): Precio sin IVA (USD)
 *   G (6): Tasa de IVA como decimal (0.105 o 0.21)
 *
 * Stock:
 *   - Si el producto está en la lista = en stock
 *   - No hay columna de estado/agotado
 *   - El agotado se gestiona manualmente con stockLocked en product_supplier_links
 *
 * Impuestos internos: ninguno
 *   finalCostArs = precioSinIva * (1 + ivaRate + iibbRate) * exchangeRate
 */
import * as XLSX from "xlsx";

export const SENTEY_SUPPLIER_CODE = "SENTEY";

export interface SenteyCatalogItem {
  codigo: string;       // Column D: SKU/código
  descripcion: string;  // Column E: descripción del producto
  precioSinIva: number; // Column F: precio USD sin IVA
  ivaRate: number;      // Column G: tasa IVA como decimal (0.105 o 0.21)
}

export interface SenteyStockConfig {
  defaultStockQty: number; // Cantidad asignada a productos en la lista
}

const DEFAULT_STOCK_CONFIG: SenteyStockConfig = {
  defaultStockQty: 10,
};

export function parseSenteyStockConfig(json: string | null | undefined): SenteyStockConfig {
  if (!json) return { ...DEFAULT_STOCK_CONFIG };
  try {
    const parsed = JSON.parse(json);
    return {
      defaultStockQty: parsed.defaultStockQty ?? DEFAULT_STOCK_CONFIG.defaultStockQty,
    };
  } catch {
    return { ...DEFAULT_STOCK_CONFIG };
  }
}

/**
 * Parsea un buffer XLSX de Sentey y retorna los productos.
 * Lee por índice de columna (sin fila de encabezado) desde el índice 3.
 * Omite: filas vacías, separadores de sección, filas sin precio válido.
 */
export function parseSenteyXLSX(buffer: Buffer): SenteyCatalogItem[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  const items: SenteyCatalogItem[] = [];

  for (const rawRow of rawData) {
    const row = rawRow as unknown[];
    if (!row || row.length < 6) continue;

    const codigoRaw = row[3]; // Column D
    const descripcionRaw = row[4]; // Column E
    const precioRaw = row[5]; // Column F
    const ivaRaw = row[6]; // Column G

    // El código debe ser un string no vacío
    if (!codigoRaw || typeof codigoRaw !== "string" || !codigoRaw.trim()) continue;

    // Precio debe ser un número positivo
    const precio =
      typeof precioRaw === "number" ? precioRaw : parseFloat(String(precioRaw ?? 0));
    if (!precio || precio <= 0) continue;

    // IVA debe ser un número (no "IVA" texto de separador de sección)
    if (ivaRaw === null || ivaRaw === undefined || typeof ivaRaw === "string") continue;
    let ivaRate =
      typeof ivaRaw === "number" ? ivaRaw : parseFloat(String(ivaRaw));
    if (!ivaRate || ivaRate <= 0) continue;
    // Normalizar: si viene como porcentaje (ej: 21) convertir a decimal (0.21)
    if (ivaRate > 1) ivaRate = ivaRate / 100;

    items.push({
      // Normalizar espacios internos (el Excel de Sentey puede tener doble espacio)
      codigo: codigoRaw.trim().replace(/\s+/g, " "),
      descripcion: descripcionRaw ? String(descripcionRaw).trim() : "",
      precioSinIva: precio,
      ivaRate,
    });
  }

  return items;
}

export function buildSenteyExtraData(item: SenteyCatalogItem): string {
  return JSON.stringify({
    sku: item.codigo,   // expuesto como "SKU Proveedor" en la página de matching
    ivaRate: item.ivaRate,
  });
}
