import type { SupplierConnector } from "./base";
import type { CatalogItem, ApiConfig } from "@/types";

export const PCARTS_BASE_URL = "https://api.pcarts.com/operations";

// ─── API response types ───────────────────────────────────────────────────────

interface PCArtsStockItem {
  sku: string;
  price: number;
  stock: number;
  sku_date_updated?: string;
}

interface PCArtsProductInfo {
  sku: string;
  sku_desc: string;
  brand?: string;
  brand_desc?: string;
  category?: string;
  category_desc?: string;
  tax_ii_rate: number;  // percentage, e.g. 17.00
  tax_iva_rate: number; // percentage, e.g. 10.50
  images?: string[];
}

interface PCArtsPage<T> {
  Products: T[];
  Paging: { offset: number; limit: number; total: number };
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class PCArtsConnector implements SupplierConnector {
  private baseUrl: string;
  private token: string;

  constructor(config: ApiConfig) {
    this.baseUrl = (config.baseUrl || PCARTS_BASE_URL).replace(/\/+$/, "");
    // Token is stored in the password field of ApiConfig
    this.token = config.password || "";
  }

  private get headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-session-token": this.token,
    };
  }

  private async fetchWithTimeout(
    url: string,
    operation: string,
    timeoutMs = 30_000
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        headers: { ...this.headers, operation },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch all pages of operation 1004 (stock + price). */
  private async fetchAllStock(): Promise<Map<string, PCArtsStockItem>> {
    const map = new Map<string, PCArtsStockItem>();
    const limit = 1000;
    let offset = 0;

    do {
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}?offset=${offset}&limit=${limit}`,
        "1004"
      );
      if (!res.ok) throw new Error(`PCArts op 1004: ${res.status} ${res.statusText}`);

      const data: PCArtsPage<PCArtsStockItem> = await res.json();
      const items = data.Products || [];
      for (const item of items) {
        if (item.sku) map.set(item.sku, item);
      }

      const total = data.Paging?.total || 0;
      offset += items.length;
      if (offset >= total || items.length === 0) break;
    } while (true);

    return map;
  }

  /** Fetch all pages of operation 1005 (catalog: names, brands, tax rates). */
  private async fetchAllCatalogInfo(): Promise<Map<string, PCArtsProductInfo>> {
    const map = new Map<string, PCArtsProductInfo>();
    const limit = 400;
    let offset = 0;

    do {
      const res = await this.fetchWithTimeout(
        `${this.baseUrl}?offset=${offset}&limit=${limit}`,
        "1005"
      );
      if (!res.ok) throw new Error(`PCArts op 1005: ${res.status} ${res.statusText}`);

      const data: PCArtsPage<PCArtsProductInfo> = await res.json();
      const items = data.Products || [];
      for (const item of items) {
        if (item.sku) map.set(item.sku, item);
      }

      const total = data.Paging?.total || 0;
      offset += items.length;
      if (offset >= total || items.length === 0) break;
    } while (true);

    return map;
  }

  async testConnection(): Promise<boolean> {
    const res = await this.fetchWithTimeout(
      `${this.baseUrl}?offset=0&limit=1`,
      "1004"
    );
    if (!res.ok) throw new Error(`PCArts: ${res.status} ${res.statusText}`);
    return true;
  }

  async fetchCatalog(): Promise<CatalogItem[]> {
    // Fetch both endpoints in parallel
    const [stockMap, catalogMap] = await Promise.all([
      this.fetchAllStock(),
      this.fetchAllCatalogInfo(),
    ]);

    const items: CatalogItem[] = [];

    for (const [sku, stockData] of Array.from(stockMap)) {
      const info = catalogMap.get(sku);

      // Tax rates come as percentages (e.g. 10.50), convert to decimal
      const ivaRate = info ? info.tax_iva_rate / 100 : 0.21;
      const internalTaxRate = info ? info.tax_ii_rate / 100 : 0;

      items.push({
        code: sku,
        description: info?.sku_desc || sku,
        price: stockData.price,   // USD pre-tax (sin IVA)
        currency: "USD",
        stockAvailable: stockData.stock > 0,
        rawData: {
          sku,                 // supplierCode = SKU for matching against our products
          ivaRate,
          internalTaxRate,
          stockQty: stockData.stock,
          brand: info?.brand_desc || info?.brand || null,
          category: info?.category_desc || info?.category || null,
          imageUrl: info?.images?.[0] || null,
        },
      });
    }

    return items;
  }
}
