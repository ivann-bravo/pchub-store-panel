import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  suppliers,
  productSupplierLinks,
  supplierPrices,
  supplierCatalogs,
} from "@/lib/db/schema";
import { eq, desc, count } from "drizzle-orm";

export async function GET() {
  try {
    // Get all suppliers
    const allSuppliers = await db.select().from(suppliers);

    // Enrich each supplier with stats
    const suppliersWithStats = await Promise.all(
      allSuppliers.map(async (supplier) => {
        // Product count from links
        const [productCountResult] = await db
          .select({ value: count() })
          .from(productSupplierLinks)
          .where(eq(productSupplierLinks.supplierId, supplier.id));

        // Total prices loaded
        const [priceCountResult] = await db
          .select({ value: count() })
          .from(supplierPrices)
          .innerJoin(
            productSupplierLinks,
            eq(supplierPrices.linkId, productSupplierLinks.id)
          )
          .where(eq(productSupplierLinks.supplierId, supplier.id));

        // Last import date
        const [lastImport] = await db
          .select({ importedAt: supplierCatalogs.importedAt })
          .from(supplierCatalogs)
          .where(eq(supplierCatalogs.supplierId, supplier.id))
          .orderBy(desc(supplierCatalogs.importedAt))
          .limit(1);

        return {
          ...supplier,
          productCount: productCountResult.value,
          priceCount: priceCountResult.value,
          lastImport: lastImport?.importedAt ?? null,
        };
      })
    );

    return NextResponse.json(suppliersWithStats);
  } catch (error) {
    console.error("GET /api/suppliers error:", error);
    return NextResponse.json(
      { error: "Failed to fetch suppliers" },
      { status: 500 }
    );
  }
}
