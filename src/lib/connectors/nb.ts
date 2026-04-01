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

export class NBConnector implements SupplierConnector {
  private config: ApiConfig;
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl || "https://api.nb.com.ar/v1").replace(/\/+$/, "");
  }

  private async authenticate(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const res = await fetchWithTimeout(`${this.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: this.config.username,
        password: this.config.password,
        mode: "api",
      }),
    });

    if (!res.ok) {
      throw new Error(`NB Auth failed: ${res.status} ${res.statusText}`);
    }

    // Try JSON first, fallback to text
    let token: string;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const data = await res.json();
      token = data.token || data.access_token || data.accessToken || "";
    } else {
      token = (await res.text()).replace(/^"|"$/g, "");
    }

    if (!token || typeof token !== "string") {
      throw new Error("NB Auth: unexpected token format");
    }

    this.token = token;
    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;
    return this.token;
  }

  async testConnection(): Promise<boolean> {
    await this.authenticate();
    return true;
  }

  async fetchCatalog(): Promise<CatalogItem[]> {
    const token = await this.authenticate();

    const res = await fetchWithTimeout(`${this.baseUrl}/`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`NB GetCatalog failed: ${res.status}`);
    }

    const items: unknown[] = await res.json();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return items.map((item: any) => {
      const ivaRate = (item.price?.iva || 21) / 100;
      const internalTaxRate = (item.price?.internalTax || 0) / 100;

      return {
        code: String(item.id),
        description: String(item.title || ""),
        price: Number(item.price?.value || 0),
        currency: "USD" as const,
        stockAvailable: (item.amountStock || 0) > 0,
        rawData: {
          ...item,
          ivaRate,
          internalTaxRate,
          stock: { nb: item.amountStock || 0 },
          sku: item.sku || null,
          ean: null,
        },
      };
    });
  }
}
