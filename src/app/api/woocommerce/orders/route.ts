import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { appendWcAuth, buildWcHeaders, getWcBaseUrl } from "@/lib/woo-sync-utils";

interface WcLineItem {
  id: number;
  product_id: number;
  name: string;
  quantity: number;
  price: number; // price per unit (as string in WC, but often number)
  total: string; // total paid for this line
  subtotal: string;
  sku: string;
}

interface WcOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  billing: { first_name: string; last_name: string };
  line_items: WcLineItem[];
  total: string;
}

// GET /api/woocommerce/orders — fetch processing orders from WC API
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const baseUrl = getWcBaseUrl();
  if (!baseUrl || !process.env.WOO_CONSUMER_KEY)
    return NextResponse.json({ error: "WooCommerce not configured" }, { status: 400 });

  try {
    const url = appendWcAuth(`${baseUrl}/wp-json/wc/v3/orders?status=processing&per_page=50&orderby=date&order=desc`);
    const res = await fetch(url, {
      headers: buildWcHeaders(),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WC error: ${text.slice(0, 200)}` }, { status: 500 });
    }

    const wcOrders: WcOrder[] = await res.json();

    // Collect all WC product IDs from line items
    const wcProductIds = Array.from(new Set(wcOrders.flatMap((o) => o.line_items.map((i) => i.product_id)))).filter(Boolean);

    // Match panel products by woocommerceId
    const panelProducts = wcProductIds.length > 0
      ? await db.select({ id: products.id, name: products.name, sku: products.sku, woocommerceId: products.woocommerceId })
          .from(products)
          .where(inArray(products.woocommerceId, wcProductIds))
      : [];

    const wcIdToPanel = new Map(panelProducts.map((p) => [p.woocommerceId!, p]));

    const orders = wcOrders.map((o) => ({
      wcOrderId: o.id,
      wcOrderRef: o.number,
      status: o.status,
      dateCreated: o.date_created,
      customerName: `${o.billing.first_name} ${o.billing.last_name}`.trim(),
      total: parseFloat(o.total),
      lineItems: o.line_items.map((li) => {
        const panel = wcIdToPanel.get(li.product_id) ?? null;
        return {
          wcLineItemId: li.id,
          wcProductId: li.product_id,
          name: li.name,
          sku: li.sku,
          quantity: li.quantity,
          unitPrice: parseFloat(li.total) / li.quantity,
          lineTotal: parseFloat(li.total),
          // Panel match
          panelProductId: panel?.id ?? null,
          panelProductName: panel?.name ?? null,
          panelSku: panel?.sku ?? null,
          matched: panel != null,
        };
      }),
    }));

    return NextResponse.json({ orders });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
