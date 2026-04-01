/**
 * WooCommerce REST API client
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/
 */

const WOO_URL = process.env.WOO_URL?.replace(/\/+$/, "") ?? "";
const WOO_KEY = process.env.WOO_CONSUMER_KEY ?? "";
const WOO_SECRET = process.env.WOO_CONSUMER_SECRET ?? "";

function getAuthHeader(): string {
  const token = Buffer.from(`${WOO_KEY}:${WOO_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

async function wooFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!WOO_URL || !WOO_KEY || !WOO_SECRET) {
    throw new Error("Variables no configuradas (WOO_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET)");
  }
  const url = `${WOO_URL}/wp-json/wc/v3${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthHeader(),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} en ${url}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`HTTP ${res.status} pero respuesta no es JSON (¿plugin de seguridad bloqueando?): ${text.slice(0, 200)}`);
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
}

export interface WooAttribute {
  id: number;
  name: string;
  slug: string;
  type: string;
  order_by: string;
  has_archives: boolean;
}

export interface WooProductImage {
  src: string;
  name?: string;
  alt?: string;
}

export interface WooProductAttribute {
  id: number;
  name: string;
  options: string[];
  visible: boolean;
}

export interface WooProductPayload {
  name?: string;
  slug?: string;
  status?: "publish" | "draft" | "private";
  description?: string;
  short_description?: string;
  sku?: string;
  regular_price?: string;
  sale_price?: string;
  date_on_sale_from?: string | null;
  date_on_sale_to?: string | null;
  manage_stock?: boolean;
  stock_quantity?: number;
  stock_status?: "instock" | "outofstock" | "onbackorder";
  weight?: string;
  dimensions?: { length: string; width: string; height: string };
  images?: WooProductImage[];
  categories?: { id: number }[];
  attributes?: WooProductAttribute[];
}

export interface WooProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  status: string;
  sku: string;
}

// ─── Connection ────────────────────────────────────────────────────────────────

export async function testConnection(): Promise<{ ok: boolean; storeName?: string; error?: string }> {
  try {
    // Use /products?per_page=1 — lightweight, reliable, works with read/write keys
    await wooFetch<unknown[]>("/products?per_page=1");

    // Try to get store name from the WP REST API (no auth needed)
    let storeName = "WooCommerce";
    try {
      const wpRes = await fetch(`${WOO_URL}/wp-json`, {
        headers: { Authorization: getAuthHeader() },
      });
      if (wpRes.ok) {
        const wp = await wpRes.json() as { name?: string };
        if (wp.name) storeName = wp.name;
      }
    } catch {}

    return { ok: true, storeName };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function fetchAllCategories(): Promise<WooCategory[]> {
  const all: WooCategory[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooCategory[]>(`/products/categories?per_page=100&page=${page}&orderby=id`);
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

// ─── Attributes ───────────────────────────────────────────────────────────────

export async function fetchAllAttributes(): Promise<WooAttribute[]> {
  return wooFetch<WooAttribute[]>("/products/attributes?per_page=100");
}

// ─── Products ─────────────────────────────────────────────────────────────────

export async function createProduct(data: WooProductPayload): Promise<WooProduct> {
  return wooFetch<WooProduct>("/products", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateProduct(wooId: number, data: WooProductPayload): Promise<WooProduct> {
  return wooFetch<WooProduct>(`/products/${wooId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export interface BatchUpdateItem extends WooProductPayload {
  id: number;
}

export interface BatchUpdateResult {
  update: WooProduct[];
}

/** Batch update up to 100 products at once */
export async function batchUpdateProducts(updates: BatchUpdateItem[]): Promise<BatchUpdateResult> {
  return wooFetch<BatchUpdateResult>("/products/batch", {
    method: "POST",
    body: JSON.stringify({ update: updates }),
  });
}
