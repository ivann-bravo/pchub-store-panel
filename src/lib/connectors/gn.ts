import type { SupplierConnector } from "./base";
import type { CatalogItem, ApiConfig } from "@/types";

const TOKEN_TTL_MS = 14 * 60 * 1000; // 14 minutes
const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export class GNConnector implements SupplierConnector {
  private config: ApiConfig;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "https://api.gruponucleosa.com").replace(/\/+$/, "");
  }

  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const res = await fetchWithTimeout(`${this.baseUrl}/Authentication/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: this.config.id,
        username: this.config.username,
        password: this.config.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`GN Auth failed: ${res.status} ${res.statusText}`);
    }

    // GN API returns the token as plain text, not JSON
    const token = (await res.text()).replace(/^"|"$/g, "");
    this.token = token;
    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;

    if (!this.token || typeof this.token !== "string") {
      throw new Error("GN Auth: unexpected token format");
    }

    return this.token;
  }

  async testConnection(): Promise<boolean> {
    // Let errors propagate so the sync route can return the message to the user
    await this.authenticate();
    return true;
  }

  async fetchCatalog(): Promise<CatalogItem[]> {
    const token = await this.authenticate();

    const res = await fetchWithTimeout(`${this.baseUrl}/API_V1/GetCatalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`GN GetCatalog failed: ${res.status}`);
    }

    const items: unknown[] = await res.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => {
      // Extract tax rates from impuestos array
      let ivaRate = 0.21; // default
      let internalTaxRate = 0;
      if (Array.isArray(item.impuestos)) {
        for (const imp of item.impuestos) {
          const desc = String(imp.imp_desc || "").toLowerCase();
          const pct = Number(imp.imp_porcentaje || 0) / 100;
          if (desc.includes("iva")) {
            ivaRate = pct;
          } else if (desc.includes("internos")) {
            internalTaxRate = pct;
          }
        }
      }

      const stockCaba = Number(item.stock_caba) || 0;
      const stockMdp = Number(item.stock_mdp) || 0;

      return {
        code: String(item.codigo || ""),
        description: String(item.item_desc_0 || ""),
        price: Number(item.precioNeto_USD || 0),
        currency: "USD" as const,
        stockAvailable: stockCaba > 0,
        rawData: {
          ...item,
          ivaRate,
          internalTaxRate,
          stock: { caba: stockCaba, mdp: stockMdp },
          sku: item.partNumber || null,
          ean: item.ean || null,
        },
      };
    });
  }

  async getExchangeRate(): Promise<number> {
    const token = await this.authenticate();

    const res = await fetchWithTimeout(`${this.baseUrl}/API_V1/GetUSDExchange`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`GN GetUSDExchange failed: ${res.status}`);
    }

    const data = await res.json();
    return Number(data.Valor || data.value || data);
  }
}
