/**
 * Ashir Technology Corp Supplier Connector
 *
 * XLSX Format (header row = row where col[0].toUpperCase() === 'COD. INTERNO'):
 * COD. INTERNO | PART NUMBER | DESCRIPCIÓN | DISTRI S/IVA | FINAL | IVA | ESTADO | DETALLES
 *
 * Special handling:
 * - COD. INTERNO is the supplier's internal code (used for catalog matching)
 * - DISTRI S/IVA is price in USD, no IVA
 * - IVA is already a decimal (0.21 or 0.105) — NOT a percentage like Invid
 * - No internal taxes — price is clean: precioSinIva * (1 + iva) * (1 + iibb) * exchangeRate
 * - ESTADO determines stock:
 *     "EN STOCK"      → enStockQty (default 15), hasStock: true
 *     "AGOTADO"       → skip row entirely (out of catalog)
 *     "PRÓXIMAMENTE"  → stockQty: 0, hasStock: false
 *     "STOCK LIMITADO"→ lowStockQty (default 10), hasStock: true
 *     "SOLO EN BUNDLE"→ lowStockQty (default 10), hasStock: true
 * - Section-header rows (category names with no price) are skipped automatically
 */

export interface AshirCatalogItem {
  codigo: string;       // COD. INTERNO
  sku: string;          // PART NUMBER
  descripcion: string;  // DESCRIPCIÓN
  detalles: string;     // DETALLES
  precioSinIva: number; // DISTRI S/IVA in USD
  ivaRate: number;      // already decimal: 0.21 or 0.105
  estado: string;       // raw ESTADO value
  stockQty: number;
  hasStock: boolean;
}

export interface AshirStockConfig {
  enStockQty: number;
  lowStockQty: number;
}

const DEFAULT_STOCK_CONFIG: AshirStockConfig = {
  enStockQty: 15,
  lowStockQty: 10,
};

export function parseAshirStockConfig(json: string | null | undefined): AshirStockConfig {
  if (!json) return { ...DEFAULT_STOCK_CONFIG };
  try {
    const parsed = JSON.parse(json);
    return {
      enStockQty: parsed.enStockQty ?? DEFAULT_STOCK_CONFIG.enStockQty,
      lowStockQty: parsed.lowStockQty ?? DEFAULT_STOCK_CONFIG.lowStockQty,
    };
  } catch {
    return { ...DEFAULT_STOCK_CONFIG };
  }
}

/**
 * Parse a row from Ashir's XLSX into structured data.
 * Returns null for rows that should be skipped (AGOTADO, section headers, no price).
 */
export function parseAshirRow(
  row: Record<string, unknown>,
  stockConfig: AshirStockConfig
): AshirCatalogItem | null {
  const codigo = String(row['COD. INTERNO'] ?? row['Cod. Interno'] ?? row['COD INTERNO'] ?? '').trim();
  const sku = String(row['PART NUMBER'] ?? row['Part Number'] ?? '').trim();
  const descripcion = String(row['DESCRIPCIÓN'] ?? row['DESCRIPCION'] ?? row['Descripción'] ?? '').trim();
  const detalles = String(row['DETALLES'] ?? row['Detalles'] ?? '').trim();

  const precioRaw = String(row['DISTRI S/IVA'] ?? row['Distri s/IVA'] ?? '');
  // Handle "USD 149" / "USD 17,81" format: strip prefix, replace comma decimal separator
  const precioClean = precioRaw.replace(/^USD\s*/i, '').replace(',', '.').trim();
  const precioSinIva = parseFloat(precioClean) || 0;
  const ivaRaw = parseFloat(String(row['IVA'] ?? row['Iva'] ?? 0)) || 0;
  const estado = String(row['ESTADO'] ?? row['Estado'] ?? '').trim().toUpperCase();

  // Skip rows without code or price (section headers, empty rows)
  if (!codigo || precioSinIva <= 0) return null;

  // AGOTADO: skip entirely — not part of catalog
  if (estado === 'AGOTADO') return null;

  // IVA comes as decimal (0.21 or 0.105)
  // Clamp to known values to avoid data issues
  const ivaRate = ivaRaw > 0 ? ivaRaw : 0.21;

  // Stock by estado
  let stockQty: number;
  let hasStock: boolean;
  switch (estado) {
    case 'EN STOCK':
      stockQty = stockConfig.enStockQty;
      hasStock = true;
      break;
    case 'STOCK LIMITADO':
    case 'SOLO EN BUNDLE':
      stockQty = stockConfig.lowStockQty;
      hasStock = true;
      break;
    case 'PRÓXIMAMENTE':
    case 'PROXIMAMENTE':
      stockQty = 0;
      hasStock = false;
      break;
    default:
      stockQty = stockConfig.lowStockQty;
      hasStock = true;
  }

  return {
    codigo,
    sku,
    descripcion,
    detalles,
    precioSinIva,
    ivaRate,
    estado,
    stockQty,
    hasStock,
  };
}

/**
 * Build extra data JSON stored in supplier_catalog_items.rawData
 */
export function buildAshirExtraData(item: AshirCatalogItem): string {
  return JSON.stringify({
    sku: item.sku,
    ivaRate: item.ivaRate,
    estado: item.estado,
    stockQty: item.stockQty,
    detalles: item.detalles,
  });
}

export const ASHIR_SUPPLIER_CODE = 'ASHIR';
