export const POLYTECH_BASE_URL =
  "https://www.gestionresellers.com.ar/api/extranet/item";

export interface PolytechSearchItem {
  sourceId: string;    // id_type 1 — used as supplierCode
  sku: string | null;  // id_type 5 — cod. fabricante
  description: string; // title field
  priceWithIva: number;
  ivaRate: number;
  precioSinIva: number;
  stock: number;        // item.stock
  stockAvailable: boolean;
  rawData: Record<string, unknown>;
}

export interface PolytechSearchResult {
  items: PolytechSearchItem[];
  total: number;
  pages: number;
  page: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parsePolytechItem(item: any): PolytechSearchItem | null {
  const ids: { id_type: number; id: string }[] = item.ids || [];

  // id_type 1 = source_id (our supplier code for matching)
  const sourceId =
    ids.find((i) => i.id_type === 1)?.id || String(item.source_id || "");
  if (!sourceId) return null;

  // id_type 5 = cod. fabricante (SKU)
  const sku = ids.find((i) => i.id_type === 5)?.id || null;

  const offer = item.offers?.[0];
  const priceWithIva = Number(offer?.price?.amount || 0);
  if (priceWithIva <= 0) return null;

  const ivaRate = parseFloat(String(item.vat || "21")) / 100;
  const precioSinIva = ivaRate > 0 ? priceWithIva / (1 + ivaRate) : priceWithIva;

  // Stock: item.stock is the direct attribute
  const stock = Number(item.stock ?? offer?.stock ?? 0);

  return {
    sourceId,
    sku,
    description: String(item.title || item.description || item.name || ""),
    priceWithIva,
    ivaRate,
    precioSinIva,
    stock,
    stockAvailable: stock > 0,
    rawData: {
      ...item,
      ivaRate,
      internalTaxRate: 0,
      stockQty: stock,
      sku: sku || sourceId,
    },
  };
}

export class PolytechConnector {
  private baseUrl: string;

  constructor(private token: string, baseUrl?: string) {
    this.baseUrl = (baseUrl || POLYTECH_BASE_URL).replace(/\/+$/, "");
  }

  private get authHeader(): string {
    return "Basic " + Buffer.from(`${this.token}:`).toString("base64");
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs = 15_000
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<boolean> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/status`, {
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) {
      throw new Error(`Polytech: ${res.status} ${res.statusText}`);
    }
    return true;
  }

  async search(keyword: string, page = 1): Promise<PolytechSearchResult> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}/search`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ keywords: keyword, page }),
      }
    );
    if (!res.ok) {
      throw new Error(`Polytech search: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawItems: any[] = Array.isArray(data.items) ? data.items : [];
    const items = rawItems
      .map(parsePolytechItem)
      .filter(Boolean) as PolytechSearchItem[];
    return {
      items,
      total: Number(data.total || 0),
      pages: Number(data.pages || 1),
      page: Number(data.page || page),
    };
  }

  /**
   * Fetches the full catalog by paginating through all pages.
   * Polytech's search with an empty keyword returns all products.
   * Respects 1 req/sec rate limit between pages.
   */
  async fetchAllPages(keyword = ""): Promise<PolytechSearchItem[]> {
    const allItems: PolytechSearchItem[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const iterStart = Date.now();
      const result = await this.search(keyword, page);

      allItems.push(...result.items);
      totalPages = result.pages || 1;

      if (page >= totalPages || result.items.length === 0) break;
      page++;

      // Rate limit: stay within 1 req/sec
      const elapsed = Date.now() - iterStart;
      const remaining = 1050 - elapsed;
      if (remaining > 0) await PolytechConnector.delay(remaining);
    } while (page <= totalPages);

    return allItems;
  }

  static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
