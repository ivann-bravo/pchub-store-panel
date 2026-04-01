/**
 * HDC Supplier Connector
 *
 * XLSX hoja única ("Table"). Estructura:
 *   Fila 1: encabezados → Marca | Categoria | SubCategoria | SubCategoria_Auxiliar | Codigo | Articulo | Precio | IVA | <stock col>
 *   Fila 2+: productos
 *
 * Columnas (0-indexed):
 *   A (0): Marca
 *   B (1): Categoria
 *   C (2): SubCategoria
 *   D (3): SubCategoria_Auxiliar (mayormente vacía)
 *   E (4): Codigo — supplierCode para vincular al catálogo
 *   F (5): Articulo — descripción del producto
 *   G (6): Precio — sin IVA, en USD
 *   H (7): IVA — string "IVA 21%" o "IVA 10,5%"
 *   I (8): Columna de stock — dos formatos posibles (auto-detectado por header):
 *     · Formato NUEVO "Disponible": número entero (0 = sin stock, N = cantidad exacta)
 *     · Formato VIEJO "Últimas Unidades": texto libre ("Ultimas 2 unidades!") o vacío
 *
 * Sin impuestos internos:
 *   finalCostArs = precioSinIva * exchangeRate * (1 + ivaRate) * (1 + taxRate)
 */
import * as XLSX from "xlsx";

export const HDC_SUPPLIER_CODE = "HDC";

export interface HdcCatalogItem {
  brand: string;
  categoria: string;
  subCategoria: string;
  codigo: string;          // Codigo — supplierCode
  descripcion: string;
  precioSinIva: number;    // USD sin IVA
  ivaRate: number;         // decimal (0.21 ó 0.105)
  stockQty: number;
  hasStock: boolean;
  lastUnits: boolean;      // true cuando dice "Últimas unidades"
}

export interface HdcStockConfig {
  defaultStockQty: number; // cantidad asignada cuando no hay indicador de últimas unidades
}

const DEFAULT_STOCK_CONFIG: HdcStockConfig = {
  defaultStockQty: 10,
};

export function parseHdcStockConfig(json: string | null | undefined): HdcStockConfig {
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
 * Parsea el string de IVA de HDC a decimal.
 * Acepta "IVA 21%", "IVA 10,5%", "IVA 10.5%", o número directo.
 */
function parseIvaRate(raw: unknown): number {
  if (typeof raw === "number") return raw > 1 ? raw / 100 : raw;
  if (typeof raw === "string") {
    // Extraer número del string (e.g. "IVA 21%" → 21, "IVA 10,5%" → 10.5)
    const cleaned = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
    const val = parseFloat(cleaned);
    if (!isNaN(val)) return val > 1 ? val / 100 : val;
  }
  return 0.21;
}

/**
 * Parsea la columna "Últimas Unidades" de HDC.
 * Devuelve la cantidad indicada en el texto (1 si no se puede extraer número).
 * Ejemplos: "Ultima Unidad!" → 1, "Ultimas 2 unidades!" → 2, "Ultimas 6 unidades" → 6
 */
function parseLastUnitsQty(raw: unknown): number {
  if (!raw) return 0;
  const text = String(raw).trim();
  if (!text) return 0;

  // Intentar extraer número del texto
  const match = text.match(/\d+/);
  if (match) return parseInt(match[0], 10);

  // "Ultima Unidad" sin número → 1
  return 1;
}

/**
 * Parsea el XLSX de HDC y retorna los ítems del catálogo.
 * Auto-detecta el formato de stock por el header de la columna I:
 *   - "Disponible" → formato nuevo: número entero (0 = sin stock)
 *   - Otro → formato viejo: texto "Últimas unidades" o vacío
 * Omite filas sin Codigo o con Precio = 0.
 */
export function parseHdcXLSX(buffer: Buffer, stockConfig: HdcStockConfig): HdcCatalogItem[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  // header: 1 → array de arrays, fila 0 son los encabezados
  const rawData = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });

  // Detectar formato por el header de la columna I (índice 8)
  const headerRow = rawData[0] as unknown[];
  const colIHeader = headerRow?.[8] != null ? String(headerRow[8]).trim().toLowerCase() : "";
  const isNewFormat = colIHeader === "disponible";

  const items: HdcCatalogItem[] = [];

  // Fila 0 = encabezados → empezar desde fila 1
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] as unknown[];
    if (!row || row.length === 0) continue;

    const codigoRaw = row[4]; // Col E
    const precioRaw = row[6]; // Col G

    // Codigo obligatorio
    if (codigoRaw == null || String(codigoRaw).trim() === "") continue;

    // Precio debe ser número positivo
    const precioSinIva =
      typeof precioRaw === "number"
        ? precioRaw
        : parseFloat(String(precioRaw ?? 0));
    if (!precioSinIva || precioSinIva <= 0) continue;

    const codigo = String(codigoRaw).trim();

    let stockQty: number;
    let hasStock: boolean;
    let lastUnits: boolean;

    if (isNewFormat) {
      // Formato nuevo: Col I = "Disponible" — número entero de unidades
      const raw = row[8];
      const disponible = typeof raw === "number" ? raw : parseInt(String(raw ?? "0"), 10);
      stockQty = isNaN(disponible) ? 0 : Math.max(0, disponible);
      hasStock = stockQty > 0;
      lastUnits = false;
    } else {
      // Formato viejo: Col I = texto "Últimas unidades" o vacío
      const lastUnitsQty = parseLastUnitsQty(row[8]);
      lastUnits = lastUnitsQty > 0;
      stockQty = lastUnits ? lastUnitsQty : stockConfig.defaultStockQty;
      hasStock = true; // Si aparece en el listado viejo → tiene stock
    }

    items.push({
      brand: row[0] != null ? String(row[0]).trim() : "",
      categoria: row[1] != null ? String(row[1]).trim() : "",
      subCategoria: row[2] != null ? String(row[2]).trim() : "",
      codigo,
      descripcion: row[5] != null ? String(row[5]).trim() : codigo,
      precioSinIva,
      ivaRate: parseIvaRate(row[7]),
      stockQty,
      hasStock,
      lastUnits,
    });
  }

  return items;
}

export function buildHdcExtraData(item: HdcCatalogItem): string {
  return JSON.stringify({
    brand: item.brand,
    categoria: item.categoria,
    subCategoria: item.subCategoria,
    ivaRate: item.ivaRate,
    lastUnits: item.lastUnits,
  });
}
