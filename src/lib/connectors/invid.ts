/**
 * Invid Supplier Connector
 *
 * XLSX Format (header row = row where col[0] === "Codigo"):
 * Codigo | Producto | Fabricante | Nro. de Parte | Precio sin IVA | %IVA | Imp. Int. | Observaciones
 *
 * Special handling:
 * - Price is "Precio sin IVA" in USD
 * - IVA comes as percentage (10.5 or 21) → convert to decimal
 * - Internal tax ("Imp. Int.") is a percentage like %IVA (e.g. 10.5 or 23.46) → divide by 100
 * - IIBB comes from supplier.taxRate
 * - Stock from "Observaciones": "Stock Bajo" → lowStockQty, empty → defaultStockQty
 */

export interface InvidCatalogItem {
  codigo: string;
  descripcion: string;
  fabricante: string;
  sku: string;
  precioSinIva: number;
  ivaRate: number; // decimal: 0.21 or 0.105
  internalTaxRate: number; // decimal: impInt% / 100 (e.g. 10.5 → 0.105)
  impInterno: number; // raw percentage value from XLSX (e.g. 10.5 or 23.46)
  observaciones: string;
  stockQty: number;
  hasStock: boolean;
}

export interface InvidStockConfig {
  lowStockQty: number;
  defaultStockQty: number;
}

const DEFAULT_STOCK_CONFIG: InvidStockConfig = {
  lowStockQty: 5,
  defaultStockQty: 20,
};

export function parseStockConfig(json: string | null | undefined): InvidStockConfig {
  if (!json) return { ...DEFAULT_STOCK_CONFIG };
  try {
    const parsed = JSON.parse(json);
    return {
      lowStockQty: parsed.lowStockQty ?? DEFAULT_STOCK_CONFIG.lowStockQty,
      defaultStockQty: parsed.defaultStockQty ?? DEFAULT_STOCK_CONFIG.defaultStockQty,
    };
  } catch {
    return { ...DEFAULT_STOCK_CONFIG };
  }
}

/**
 * Find column value by trying multiple header names (case-insensitive)
 */
function findCol(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return String(row[key]).trim();
    }
  }
  // Case-insensitive fallback
  const rowKeys = Object.keys(row);
  for (const searchKey of keys) {
    const lower = searchKey.toLowerCase();
    for (const rk of rowKeys) {
      if (rk.toLowerCase() === lower) {
        const val = row[rk];
        if (val !== undefined && val !== null && val !== '') {
          return String(val).trim();
        }
      }
    }
  }
  return '';
}

/**
 * Parse a row from Invid's XLSX into structured data
 */
export function parseInvidRow(
  row: Record<string, unknown>,
  stockConfig: InvidStockConfig
): InvidCatalogItem | null {
  // Strip leading zeros from code (XLSX has "0416340", links stored as "416340")
  const codigo = findCol(row, ['Codigo', 'Código', 'codigo']).replace(/^0+(?=\d)/, '');
  const descripcion = findCol(row, ['Producto', 'producto', 'Descripcion', 'Descripción']);
  const fabricante = findCol(row, ['Fabricante', 'fabricante', 'Marca']);
  const sku = findCol(row, ['Nro. de Parte', 'Nro de Parte', 'NroDeParte', 'Part Number', 'PartNumber']);

  const precioStr = findCol(row, ['Precio sin IVA', 'Precio Sin IVA', 'PrecioSinIVA', 'Precio sin Iva']);
  const ivaStr = findCol(row, ['%IVA', '%iva', 'IVA', 'iva']);
  const impIntStr = findCol(row, ['Imp. Int.', 'Imp Int', 'ImpInt', 'Imp. Internos']);
  const observaciones = findCol(row, ['Observaciones', 'observaciones', 'Obs']);

  const precioSinIva = parseFloat(precioStr.replace(',', '.')) || 0;

  // Skip rows without code or price
  if (!codigo || precioSinIva <= 0) {
    return null;
  }

  // IVA: comes as 21 or 10.5 → decimal
  const ivaValue = parseFloat(ivaStr) || 21;
  const ivaRate = ivaValue / 100;

  // Internal tax: percentage value like %IVA (e.g. 10.5 means 10.5%) → divide by 100
  const impInterno = parseFloat(impIntStr.replace(',', '.')) || 0;
  const internalTaxRate = impInterno / 100;

  // Stock from observations
  const isLowStock = observaciones.toLowerCase().includes('stock bajo');
  const stockQty = isLowStock ? stockConfig.lowStockQty : stockConfig.defaultStockQty;

  return {
    codigo,
    descripcion,
    fabricante,
    sku,
    precioSinIva,
    ivaRate,
    internalTaxRate,
    impInterno,
    observaciones,
    stockQty,
    hasStock: true, // all items in catalog are considered in stock
  };
}

/**
 * Build extra data JSON for catalog item
 */
export function buildInvidExtraData(item: InvidCatalogItem): string {
  return JSON.stringify({
    fabricante: item.fabricante,
    sku: item.sku,
    ivaRate: item.ivaRate,
    internalTaxRate: item.internalTaxRate,
    impInterno: item.impInterno,
    observaciones: item.observaciones,
    stockQty: item.stockQty,
  });
}

export const INVID_SUPPLIER_CODE = 'INVID';
