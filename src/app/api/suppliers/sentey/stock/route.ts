/**
 * Gestión de stock manual para Sentey.
 *
 * GET  → lista los productos vinculados a Sentey con su estado de stock
 * PATCH → bloquea o desbloquea el stock de un producto específico
 *
 * Cuando stockLocked = true, las importaciones futuras NO actualizan el stock
 * del producto, manteniendo el qty en 0 (agotado).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { suppliers, productSupplierLinks, products, supplierPrices } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { parseSenteyStockConfig } from "@/lib/connectors/sentey";

function getSenteySupplier() {
  return db
    .select()
    .from(suppliers)
    .where(sql`UPPER(${suppliers.code}) = 'SENTEY'`)
    .get();
}

export async function GET() {
  try {
    const supplier = getSenteySupplier();

    if (!supplier) {
      return NextResponse.json({ items: [] });
    }

    const links = db
      .select({
        linkId: productSupplierLinks.id,
        supplierCode: productSupplierLinks.supplierCode,
        supplierStockQty: productSupplierLinks.supplierStockQty,
        stockLocked: productSupplierLinks.stockLocked,
        productId: products.id,
        productName: products.name,
        productSku: products.sku,
        hasSupplierStock: products.hasSupplierStock,
      })
      .from(productSupplierLinks)
      .innerJoin(products, eq(productSupplierLinks.productId, products.id))
      .where(eq(productSupplierLinks.supplierId, supplier.id))
      .all();

    // Enriquecer con precio
    const enriched = links.map((link) => {
      const price = db
        .select({ rawPrice: supplierPrices.rawPrice, finalCostArs: supplierPrices.finalCostArs })
        .from(supplierPrices)
        .where(eq(supplierPrices.linkId, link.linkId))
        .get();

      return {
        ...link,
        rawPrice: price?.rawPrice ?? null,
        finalCostArs: price?.finalCostArs ?? null,
      };
    });

    return NextResponse.json({ items: enriched });
  } catch (error) {
    console.error("Sentey stock GET error:", error);
    return NextResponse.json({ error: "Error al obtener productos" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { linkId, locked } = (await request.json()) as {
      linkId: number;
      locked: boolean;
    };

    if (typeof linkId !== "number" || typeof locked !== "boolean") {
      return NextResponse.json({ error: "Parámetros inválidos" }, { status: 400 });
    }

    const supplier = getSenteySupplier();
    if (!supplier) {
      return NextResponse.json({ error: "Proveedor Sentey no encontrado" }, { status: 404 });
    }

    const existingLink = db
      .select()
      .from(productSupplierLinks)
      .where(eq(productSupplierLinks.id, linkId))
      .get();

    if (!existingLink) {
      return NextResponse.json({ error: "Link no encontrado" }, { status: 404 });
    }

    if (existingLink.supplierId !== supplier.id) {
      return NextResponse.json({ error: "Link no pertenece a Sentey" }, { status: 403 });
    }

    const stockConfig = parseSenteyStockConfig(supplier.stockConfig);
    const newQty = locked ? 0 : stockConfig.defaultStockQty;

    db.update(productSupplierLinks)
      .set({
        stockLocked: locked,
        supplierStockQty: newQty,
      })
      .where(eq(productSupplierLinks.id, linkId))
      .run();

    db.update(products)
      .set({
        hasSupplierStock: !locked,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(products.id, existingLink.productId))
      .run();

    return NextResponse.json({ success: true, locked, supplierStockQty: newQty });
  } catch (error) {
    console.error("Sentey stock PATCH error:", error);
    return NextResponse.json({ error: "Error al actualizar stock" }, { status: 500 });
  }
}
