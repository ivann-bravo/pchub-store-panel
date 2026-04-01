import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_WOO_MSG } from "@/lib/demo";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products, wooAttributeMappings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { appendWcAuth, buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

interface WcCreatedProduct {
  id: number;
  permalink?: string;
}

/**
 * POST /api/woocommerce/create-product
 * Body: { productId: number; extraAttributes?: { panelKey: string; value: string }[] }
 * Creates the product in WooCommerce and saves the returned woocommerceId back to the panel DB.
 */
export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_WOO_MSG, demo: true });
  }
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const baseUrl = getWcBaseUrl();
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY) {
    return NextResponse.json({ error: "WooCommerce env vars not configured" }, { status: 400 });
  }

  const { productId, extraAttributes = [] } = await request.json() as {
    productId: number;
    extraAttributes?: { panelKey: string; value: string }[];
  };
  if (!productId) {
    return NextResponse.json({ error: "productId required" }, { status: 400 });
  }

  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (product.woocommerceId) {
    return NextResponse.json({ error: "Product already has a woocommerceId", woocommerceId: product.woocommerceId }, { status: 409 });
  }

  const mappings = await db.select().from(wooAttributeMappings);

  type WcAttr = { id: number; name: string; options: string[]; visible: boolean };
  const attributes: WcAttr[] = [];

  const addAttr = (panelKey: string, value: string | null | undefined) => {
    if (!value) return;
    const m = mappings.find((x) => x.panelKey === panelKey);
    if (!m) return;
    attributes.push({ id: m.wooAttributeId, name: m.wooAttributeName, options: [value], visible: true });
  };

  // Auto-derived attributes
  addAttr("iva", product.ivaRate === 0.105 ? "0.105" : "0.21");
  addAttr("brand", product.brand);
  addAttr("warranty", product.warranty);

  // Extra attributes from the form
  for (const ea of extraAttributes) {
    if (ea.value) addAttr(ea.panelKey, ea.value);
  }

  // Build basic WC payload — created as "private" so it doesn't appear in the store until synced
  const payload: Record<string, unknown> = {
    name: product.name,
    status: "private",
    manage_stock: true,
    stock_quantity: product.localStock ?? 0,
    stock_status: (product.localStock ?? 0) > 0 ? "instock" : "outofstock",
    regular_price: "0",
  };

  if (product.sku) payload.sku = product.sku;
  if (product.shortDescription) payload.short_description = product.shortDescription;
  if (product.description) payload.description = product.description;
  if (product.weightKg) payload.weight = product.weightKg.toString();
  if (product.lengthCm || product.widthCm || product.heightCm) {
    payload.dimensions = {
      length: (product.lengthCm ?? 0).toString(),
      width: (product.widthCm ?? 0).toString(),
      height: (product.heightCm ?? 0).toString(),
    };
  }
  if (attributes.length > 0) payload.attributes = attributes;
  if (product.wooCategoryIds) {
    try {
      const ids = JSON.parse(product.wooCategoryIds) as number[];
      payload.categories = ids.map((id) => ({ id }));
    } catch {}
  }

  // Images are uploaded separately via /api/woocommerce/upload-product-image
  // (WC sideloading fails for supplier CDN URLs — we proxy the upload instead)

  try {
    const res = await fetch(appendWcAuth(`${baseUrl}/wp-json/wc/v3/products`), {
      method: "POST",
      headers: buildWcHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WooCommerce error HTTP ${res.status}: ${text.slice(0, 300)}` }, { status: 502 });
    }

    const wc = await res.json() as WcCreatedProduct;

    await db.update(products).set({
      woocommerceId: wc.id,
      storeUrl: wc.permalink ?? product.storeUrl,
      wooSyncPending: true,
    }).where(eq(products.id, productId));

    return NextResponse.json({ woocommerceId: wc.id, permalink: wc.permalink });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
