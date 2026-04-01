/**
 * Latamly Supplier Connector
 *
 * XLSX con múltiples hojas (una por marca). Estructura por hoja:
 *   Fila 0: encabezado → Marca | EAN | SKU | Descripcion | Familia de producto | IVA | Precio USD | Pedido | Total USD Sin IVA | DISPONIBILIDAD
 *   Fila 1: separador (solo tiene el nombre de marca en col A)
 *   Fila 2+: productos
 *
 * Columnas (0-indexed):
 *   A (0): Marca
 *   B (1): EAN
 *   C (2): SKU — usado como supplierCode y para vincular al catálogo
 *   D (3): Descripción
 *   E (4): Familia de producto (categoría)
 *   F (5): IVA — decimal (0.21, 0.105) o string "21.00%"/"10.50%" según la hoja
 *   G (6): Precio USD sin IVA
 *   H (7): Pedido (ignorado)
 *   I (8): Total USD Sin IVA (ignorado)
 *   J (9): DISPONIBILIDAD — número entero, "SIN STOCK" o "EN STOCK"
 *
 * Sin impuestos internos:
 *   finalCostArs = precioSinIva * (1 + ivaRate + iibbRate) * exchangeRate
 */
import * as XLSX from "xlsx";

export const LATAMLY_SUPPLIER_CODE = "LATAMLY";

export interface LatamlyCatalogItem {
  brand: string;
  ean: string | null;
  sku: string;          // Col C — supplierCode para vincular
  descripcion: string;
  categoria: string;
  ivaRate: number;      // decimal normalizado (0.21 o 0.105)
  precioSinIva: number; // Col G — USD sin IVA
  stockQty: number;     // Col J — cantidad real
  hasStock: boolean;
  sheetName: string;    // nombre de la hoja de origen
}

export interface LatamlyStockConfig {
  enStockQty: number; // cantidad asignada cuando el stock dice "EN STOCK" (sin número)
}

const DEFAULT_STOCK_CONFIG: LatamlyStockConfig = {
  enStockQty: 10,
};

export function parseLatamlyStockConfig(json: string | null | undefined): LatamlyStockConfig {
  if (!json) return { ...DEFAULT_STOCK_CONFIG };
  try {
    const parsed = JSON.parse(json);
    return {
      enStockQty: parsed.enStockQty ?? DEFAULT_STOCK_CONFIG.enStockQty,
    };
  } catch {
    return { ...DEFAULT_STOCK_CONFIG };
  }
}

/** Normaliza IVA a decimal: acepta 0.21, 0.105, "21.00%", "10.50%" */
function normalizeIvaRate(raw: unknown): number {
  if (typeof raw === "number") {
    return raw > 1 ? raw / 100 : raw;
  }
  if (typeof raw === "string") {
    const val = parseFloat(raw.replace("%", "").trim());
    if (!isNaN(val)) return val > 1 ? val / 100 : val;
  }
  return 0.21;
}

/** Parsea stock: número real, "SIN STOCK" → 0, "EN STOCK" → enStockQty */
function parseStock(
  raw: unknown,
  enStockQty: number
): { qty: number; hasStock: boolean } {
  if (typeof raw === "string") {
    const upper = raw.trim().toUpperCase();
    if (upper === "SIN STOCK") return { qty: 0, hasStock: false };
    if (upper === "EN STOCK") return { qty: enStockQty, hasStock: true };
    const n = parseInt(raw, 10);
    if (!isNaN(n)) return { qty: Math.max(0, n), hasStock: n > 0 };
  }
  if (typeof raw === "number") {
    const qty = Math.max(0, Math.round(raw));
    return { qty, hasStock: qty > 0 };
  }
  return { qty: 0, hasStock: false };
}

/**
 * Parsea todas las hojas del XLSX de Latamly y retorna los productos.
 * Omite la fila 0 (encabezado) y filas sin SKU o sin precio válido.
 */
export function parseLatamlyXLSX(
  buffer: Buffer,
  stockConfig: LatamlyStockConfig
): LatamlyCatalogItem[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const items: LatamlyCatalogItem[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
    });

    // Fila 0 = encabezado → empezar desde fila 1
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i] as unknown[];

      const skuRaw = row[2]; // Col C
      const priceRaw = row[6]; // Col G

      // SKU debe ser string no vacío
      if (!skuRaw || typeof skuRaw !== "string" || !skuRaw.trim()) continue;

      // Precio debe ser número positivo
      const precioSinIva =
        typeof priceRaw === "number"
          ? priceRaw
          : parseFloat(String(priceRaw ?? 0));
      if (!precioSinIva || precioSinIva <= 0) continue;

      const eanRaw = row[1];
      const ean = eanRaw != null ? String(eanRaw).trim() || null : null;

      const { qty: stockQty, hasStock } = parseStock(row[9], stockConfig.enStockQty);

      items.push({
        brand: row[0] ? String(row[0]).trim() : sheetName,
        ean,
        sku: skuRaw.trim().replace(/\s+/g, " "),
        descripcion: row[3] ? String(row[3]).trim() : "",
        categoria: row[4] ? String(row[4]).trim() : "",
        ivaRate: normalizeIvaRate(row[5]),
        precioSinIva,
        stockQty,
        hasStock,
        sheetName,
      });
    }
  }

  return items;
}

export function buildLatamlyExtraData(item: LatamlyCatalogItem): string {
  return JSON.stringify({
    sku: item.sku,
    ean: item.ean,
    brand: item.brand,
    categoria: item.categoria,
    ivaRate: item.ivaRate,
    sheet: item.sheetName,
  });
}
