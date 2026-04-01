import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products, productSupplierLinks, supplierPrices, wooAttributeMappings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { roundToNine } from "@/lib/number-format";

/**
 * GET /api/woocommerce/sync-payload/[id]
 * Computes the WooCommerce product payload for a panel product.
 * The browser uses this to call WooCommerce directly (avoids Railway → Wordfence block).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const productId = parseInt(params.id, 10);
  if (isNaN(productId)) return NextResponse.json({ error: "Invalid ID" }, { status: 400 });

  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!product.woocommerceId) return NextResponse.json({ error: "No woocommerceId set" }, { status: 400 });

  // Attribute mappings (for IVA)
  const mappings = await db.select().from(wooAttributeMappings);

  // Supplier links → best price + stock
  const links = await db
    .select({
      isActive: productSupplierLinks.isActive,
      stockQty: productSupplierLinks.supplierStockQty,
      finalCostArs: supplierPrices.finalCostArs,
    })
    .from(productSupplierLinks)
    .leftJoin(supplierPrices, eq(supplierPrices.linkId, productSupplierLinks.id))
    .where(eq(productSupplierLinks.productId, productId));

  const activeLinks = links.filter((l) => l.isActive);
  const withStock = activeLinks
    .filter((l) => (l.stockQty ?? 0) > 0 && l.finalCostArs != null)
    .sort((a, b) => (a.finalCostArs ?? 0) - (b.finalCostArs ?? 0));

  const bestCostArs = withStock[0]?.finalCostArs ?? null;
  const supplierTotalStock = activeLinks.reduce((s, l) => s + (l.stockQty ?? 0), 0);

  // --- Stock & pricing decision (3 cases) ---
  // Case 1: Own stock/price — we control this product (featured)
  //   Trigger: localStock > 0 OR ownPriceRegular/ownPriceOffer is set
  //   → publish, instock, featured=true
  // Case 2: Supplier stock only — available via supplier (not featured)
  //   Trigger: no own stock & no own price, but supplier has stock + calculated price
  //   → publish, instock, featured=false
  // Case 3: No stock anywhere
  //   Trigger: no own stock, no own price, no supplier stock
  //   → private, outofstock, featured=false, no price

  const hasOwnStock = product.localStock > 0;
  const hasOwnPrice = product.ownPriceRegular != null || product.ownPriceOffer != null;
  const hasSupplierStockActual = supplierTotalStock > 0;
  const hasCalculatedPrice = bestCostArs != null;

  let status: string;
  let stockStatus: string;
  let featured: boolean;
  let regularPrice: number | null;
  let offerPrice: number | null;
  let stockQty: number;

  if (hasOwnStock || hasOwnPrice) {
    // Case 1: own stock or own price — featured
    status = "publish";
    stockStatus = "instock";
    featured = true;
    stockQty = product.localStock + supplierTotalStock;
    regularPrice = product.ownPriceRegular
      ?? (bestCostArs ? bestCostArs * product.markupRegular : null);
    offerPrice = product.ownPriceOffer
      ?? (product.markupOffer && bestCostArs ? bestCostArs * product.markupOffer : null);
  } else if (hasSupplierStockActual && hasCalculatedPrice) {
    // Case 2: supplier stock only — not featured
    status = "publish";
    stockStatus = "instock";
    featured = false;
    stockQty = supplierTotalStock;
    regularPrice = bestCostArs * product.markupRegular;
    offerPrice = product.markupOffer && bestCostArs ? bestCostArs * product.markupOffer : null;
  } else {
    // Case 3: no stock anywhere
    status = "private";
    stockStatus = "outofstock";
    featured = false;
    stockQty = 0;
    regularPrice = null;
    offerPrice = null;
  }

  // ── Safeguard checks ─────────────────────────────────────────────────────
  const wooSyncedRegularPrice = product.wooSyncedRegularPrice ?? null;
  const inStock = stockStatus === "instock";
  let safeguard: { blocked: boolean; reason?: string; newPrice?: number | null; oldPrice?: number | null } = { blocked: false };

  if (inStock && (regularPrice == null || regularPrice <= 0)) {
    safeguard = {
      blocked: true,
      reason: "Sin precio configurado: el producto aparecería a $0 en la tienda",
      newPrice: regularPrice ?? 0,
      oldPrice: wooSyncedRegularPrice,
    };
  } else if (
    !safeguard.blocked &&
    wooSyncedRegularPrice != null &&
    wooSyncedRegularPrice > 0 &&
    regularPrice != null &&
    regularPrice < wooSyncedRegularPrice * 0.90
  ) {
    const dropPercent = Math.round((1 - regularPrice / wooSyncedRegularPrice) * 100);
    safeguard = {
      blocked: true,
      reason: `Bajada de precio del ${dropPercent}%: de $${Math.round(wooSyncedRegularPrice).toLocaleString("es-AR")} a $${Math.round(regularPrice).toLocaleString("es-AR")}`,
      newPrice: regularPrice,
      oldPrice: wooSyncedRegularPrice,
    };
  }

  // IVA attribute
  const ivaMapping = mappings.find((m) => m.panelKey === "iva");
  const ivaValue = product.ivaRate === 0.105 ? "0.105" : "0.21";
  const attributes = ivaMapping
    ? [{ id: ivaMapping.wooAttributeId, name: ivaMapping.wooAttributeName, options: [ivaValue], visible: true }]
    : [];

  const data: Record<string, unknown> = {
    name: product.name,
    status,
    featured,
    manage_stock: true,
    stock_quantity: stockQty,
    stock_status: stockStatus,
    regular_price: regularPrice ? String(roundToNine(regularPrice)) : "0",
    sale_price: offerPrice ? String(roundToNine(offerPrice)) : "",
    date_on_sale_from: offerPrice && product.offerStart ? product.offerStart : null,
    date_on_sale_to: offerPrice && product.offerEnd ? product.offerEnd : null,
    attributes,
  };

  if (product.sku) data.sku = product.sku;
  if (product.shortDescription) data.short_description = product.shortDescription;
  if (product.description) data.description = product.description;
  if (product.weightKg) data.weight = product.weightKg.toString();
  if (product.lengthCm || product.widthCm || product.heightCm) {
    data.dimensions = {
      length: (product.lengthCm ?? 0).toString(),
      width: (product.widthCm ?? 0).toString(),
      height: (product.heightCm ?? 0).toString(),
    };
  }

  return NextResponse.json({ wooId: product.woocommerceId, data, safeguard });
}
