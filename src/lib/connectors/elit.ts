import type { SupplierConnector } from "./base";
import type { CatalogItem, ApiConfig } from "@/types";

const MAX_PAGES = 200;
const PAGE_SIZE = 100;
const DELAY_MS = 300;
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class ElitConnector implements SupplierConnector {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "https://clientes.elit.com.ar/v1/api").replace(/\/+$/, "");
  }

  private get userId(): number {
    return this.config.id ?? 0;
  }

  private get token(): string {
    return this.config.password || "";
  }

  async testConnection(): Promise<boolean> {
    const res = await fetchWithTimeout(`${this.baseUrl}/productos?limit=1&offset=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: this.userId, token: this.token }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Elit test failed: ${res.status} ${res.statusText} ${body}`);
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.resultado)) {
      throw new Error("Elit: unexpected response format");
    }

    return true;
  }

  async fetchCatalog(): Promise<CatalogItem[]> {
    const allItems: CatalogItem[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      const offset = page * PAGE_SIZE + 1; // Elit API requires offset >= 1

      const res = await fetchWithTimeout(`${this.baseUrl}/productos?limit=${PAGE_SIZE}&offset=${offset}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: this.userId, token: this.token }),
      });

      if (!res.ok) {
        throw new Error(`Elit fetchCatalog failed at offset ${offset}: ${res.status}`);
      }

      const data = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = data?.resultado ?? [];

      if (!Array.isArray(items) || items.length === 0) {
        break;
      }

      for (const item of items) {
        const precio = Number(item.precio || 0);
        if (precio === 0) continue;

        const moneda = Number(item.moneda);
        const currency = moneda === 1 ? "ARS" : "USD";
        const stockTotal = Number(item.stock_total || 0);

        // iva comes as percentage (e.g. 21 for 21%), convert to rate
        const ivaRate = Number(item.iva || 0) / 100;
        const internalTaxRate = Number(item.impuesto_interno || 0) / 100;

        allItems.push({
          code: String(item.codigo_alfa || ""),
          description: String(item.nombre || ""),
          price: precio,
          currency,
          stockAvailable: stockTotal > 0,
          rawData: {
            ivaRate,
            internalTaxRate,
            stock: { elit: stockTotal },
            sku: item.codigo_producto || null,
            ean: item.ean || null,
            marca: item.marca || null,
            garantia: item.garantia || null,
            peso: item.peso || null,
            categoria: item.categoria || null,
            sub_categoria: item.sub_categoria || null,
            cotizacion: item.cotizacion || null,
          },
        });
      }

      if (items.length < PAGE_SIZE) {
        break;
      }

      if (page < MAX_PAGES - 1) {
        await delay(DELAY_MS);
      }
    }

    return allItems;
  }
}
