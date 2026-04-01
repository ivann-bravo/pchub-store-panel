/**
 * AIR Supplier Connector
 *
 * CSV Format:
 * "Codigo","Descripcion","[Precio USD]","Tipo","IVA","ROS","MZA","CBA","LUG","Grupo","Rubro","Part Number"
 *
 * Special handling:
 * - IVA comes from CSV (10.5 or 21) -> convert to decimal
 * - Internal taxes (10.5%) for monitors from: Asus, Dell, Gigabyte, Hikvision, LG, MSI
 * - Only LUG stock counts as "available"
 * - Store ROS, MZA, CBA as extra data
 */

export interface AirCatalogItem {
  codigo: string;
  descripcion: string;
  precioUsd: number;
  tipo: string;
  ivaRate: number; // 0.21 or 0.105
  internalTaxRate: number; // 0.105 for certain monitors, 0 otherwise
  stockRos: number;
  stockMza: number;
  stockCba: number;
  stockLug: number;
  grupo: string;
  rubro: string;
  sku: string;
  hasStock: boolean; // true if LUG > 0
}

// Brands that have 10.5% internal tax on monitors
const MONITOR_INTERNAL_TAX_BRANDS = [
  'asus',
  'dell',
  'gigabyte',
  'hikvision',
  'lg',
  'msi',
];

/**
 * Check if a product description indicates a monitor from a brand with internal taxes
 */
function hasInternalTax(description: string): boolean {
  const descLower = description.toLowerCase();

  // Check if it's a monitor
  const isMonitor = descLower.includes('monitor') ||
                    descLower.includes('pantalla') ||
                    descLower.includes('display');

  if (!isMonitor) return false;

  // Check if it's from a brand with internal taxes
  return MONITOR_INTERNAL_TAX_BRANDS.some(brand => descLower.includes(brand));
}

/**
 * Clean BOM and whitespace from a string
 */
function cleanKey(key: string): string {
  return key.replace(/[\uFEFF]/g, '').replace(/ï»¿/g, '').trim();
}

/**
 * Helper to find a value in a row by trying multiple possible keys
 * Handles BOM characters in CSV headers and case-insensitive matching
 */
function findValue(row: Record<string, unknown>, keys: string[], defaultVal: string = ''): string {
  // First try exact matches
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return String(row[key]).trim();
    }
  }

  // Try matching after cleaning BOM characters from row keys
  const rowKeys = Object.keys(row);
  for (const searchKey of keys) {
    if (!searchKey) continue;
    const searchLower = searchKey.toLowerCase();
    for (const rowKey of rowKeys) {
      const cleanedRowKey = cleanKey(rowKey).toLowerCase();
      if (cleanedRowKey === searchLower) {
        const val = row[rowKey];
        if (val !== undefined && val !== null && val !== '') {
          return String(val).trim();
        }
      }
    }
  }

  return defaultVal;
}

/**
 * Get value by column index from a row (fallback for problematic headers)
 */
function getByIndex(row: Record<string, unknown>, index: number): string {
  const keys = Object.keys(row);
  if (index < keys.length) {
    const val = row[keys[index]];
    if (val !== undefined && val !== null) {
      return String(val).trim();
    }
  }
  return '';
}

/**
 * Parse a row from AIR's CSV into structured data
 */
export function parseAirRow(row: Record<string, unknown>): AirCatalogItem | null {
  // AIR CSV format (columns by index):
  // 0: Codigo, 1: Descripcion, 2: Precio USD, 3: Tipo, 4: IVA, 5: ROS, 6: MZA, 7: CBA, 8: LUG, 9: Grupo, 10: Rubro, 11: Part Number

  // Try named columns first, then fall back to index-based access
  let codigo = findValue(row, ['Codigo', 'Código', 'codigo', 'código', 'CODIGO']);
  if (!codigo) codigo = getByIndex(row, 0);

  let descripcion = findValue(row, ['Descripcion', 'Descripción', 'descripcion', 'descripción', 'DESCRIPCION']);
  if (!descripcion) descripcion = getByIndex(row, 1);

  // Price column (index 2) - may have empty header or various names
  let precioStr = findValue(row, ['__col_2__', 'Precio USD', 'Precio', 'precio', 'PRECIO']);
  if (!precioStr) precioStr = getByIndex(row, 2);
  if (!precioStr) precioStr = '0';

  let tipo = findValue(row, ['Tipo', 'tipo', 'TIPO']);
  if (!tipo) tipo = getByIndex(row, 3);

  let ivaStr = findValue(row, ['IVA', 'iva', 'Iva']);
  if (!ivaStr) ivaStr = getByIndex(row, 4);
  if (!ivaStr) ivaStr = '21';

  let rosStr = findValue(row, ['ROS', 'ros']);
  if (!rosStr) rosStr = getByIndex(row, 5);
  if (!rosStr) rosStr = '0';

  let mzaStr = findValue(row, ['MZA', 'mza']);
  if (!mzaStr) mzaStr = getByIndex(row, 6);
  if (!mzaStr) mzaStr = '0';

  let cbaStr = findValue(row, ['CBA', 'cba']);
  if (!cbaStr) cbaStr = getByIndex(row, 7);
  if (!cbaStr) cbaStr = '0';

  let lugStr = findValue(row, ['LUG', 'lug']);
  if (!lugStr) lugStr = getByIndex(row, 8);
  if (!lugStr) lugStr = '0';

  let grupo = findValue(row, ['Grupo', 'grupo', 'GRUPO']);
  if (!grupo) grupo = getByIndex(row, 9);

  let rubro = findValue(row, ['Rubro', 'rubro', 'RUBRO']);
  if (!rubro) rubro = getByIndex(row, 10);

  let sku = findValue(row, ['Part Number', 'part number', 'PartNumber', 'Part_Number']);
  if (!sku) sku = getByIndex(row, 11);

  // Parse price - handle both comma and dot as decimal separator
  const precioUsd = parseFloat(precioStr.replace(',', '.')) || 0;

  // Skip rows without code or price (but allow alphanumeric codes)
  if (!codigo || precioUsd <= 0) {
    return null;
  }

  // Parse IVA rate (CSV has 21 or 10.5, convert to decimal)
  const ivaValue = parseFloat(ivaStr) || 21;
  const ivaRate = ivaValue / 100; // 0.21 or 0.105

  // Parse stock values
  const stockRos = parseInt(rosStr) || 0;
  const stockMza = parseInt(mzaStr) || 0;
  const stockCba = parseInt(cbaStr) || 0;
  const stockLug = parseInt(lugStr) || 0;

  // Determine internal tax rate
  const internalTaxRate = hasInternalTax(descripcion) ? 0.105 : 0;

  return {
    codigo,
    descripcion,
    precioUsd,
    tipo,
    ivaRate,
    internalTaxRate,
    stockRos,
    stockMza,
    stockCba,
    stockLug,
    grupo,
    rubro,
    sku,
    hasStock: stockLug > 0,
  };
}

/**
 * Build extra data JSON for catalog item
 */
export function buildAirExtraData(item: AirCatalogItem): string {
  return JSON.stringify({
    tipo: item.tipo,
    ivaRate: item.ivaRate,
    internalTaxRate: item.internalTaxRate,
    stock: {
      ros: item.stockRos,
      mza: item.stockMza,
      cba: item.stockCba,
      lug: item.stockLug,
    },
    grupo: item.grupo,
    rubro: item.rubro,
    sku: item.sku,
  });
}

export const AIR_SUPPLIER_CODE = 'AIR';

export const AIR_COLUMN_MAPPING = {
  code: 'Codigo',
  description: 'Descripcion',
  price: '', // Column index 2 (unnamed)
  iva: 'IVA',
  stockRos: 'ROS',
  stockMza: 'MZA',
  stockCba: 'CBA',
  stockLug: 'LUG',
  grupo: 'Grupo',
  rubro: 'Rubro',
  sku: 'Part Number',
};
