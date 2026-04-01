export interface PricingInput {
  rawPriceUSD: number;
  ivaRate: number;           // 0.21 o 0.105 (por producto)
  iibbRate: number;          // por proveedor (taxRate)
  internalTaxRate: number;   // por producto (default 0)
  exchangeRate: number;      // dólar venta
  markupRegular: number;     // por producto (ej: 1.12)
  markupOffer?: number | null;
}

export interface PricingResult {
  supplierCostARS: number;
  clientPrice: number;
  clientOfferPrice: number | null;
  margin: number;
}

/**
 * Calcula el costo del proveedor en ARS (sin markup).
 * Fórmula: rawPriceUSD * (1 + IVA + IIBB + impInternos) * dólarVenta
 */
export function calculateSupplierCost(
  rawPriceUSD: number,
  ivaRate: number,
  iibbRate: number,
  internalTaxRate: number,
  exchangeRate: number
): number {
  return rawPriceUSD * (1 + ivaRate + iibbRate + internalTaxRate) * exchangeRate;
}

/**
 * Calcula pricing completo: costo proveedor, precio cliente, oferta, margen.
 */
export function calculatePricing(input: PricingInput): PricingResult {
  const {
    rawPriceUSD,
    ivaRate,
    iibbRate,
    internalTaxRate,
    exchangeRate,
    markupRegular,
    markupOffer,
  } = input;

  const supplierCostARS = calculateSupplierCost(
    rawPriceUSD,
    ivaRate,
    iibbRate,
    internalTaxRate,
    exchangeRate
  );

  const clientPrice = supplierCostARS * markupRegular;
  const clientOfferPrice = markupOffer ? supplierCostARS * markupOffer : null;
  const margin = clientPrice - supplierCostARS;

  return {
    supplierCostARS: Math.round(supplierCostARS * 100) / 100,
    clientPrice: Math.round(clientPrice * 100) / 100,
    clientOfferPrice: clientOfferPrice ? Math.round(clientOfferPrice * 100) / 100 : null,
    margin: Math.round(margin * 100) / 100,
  };
}

export function findBestPrice(
  prices: { finalCostArs: number; supplierCode: string; stockQty?: number }[]
): { finalCostArs: number; supplierCode: string; stockQty?: number } | null {
  if (prices.length === 0) return null;
  const withStock = prices.filter(p => (p.stockQty ?? 0) > 0);
  const pool = withStock.length > 0 ? withStock : prices;
  return pool.reduce((best, current) =>
    current.finalCostArs < best.finalCostArs ? current : best
  );
}
