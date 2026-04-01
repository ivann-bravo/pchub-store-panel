import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_SYNC_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import {
  suppliers,
  supplierCatalogs,
  supplierCatalogItems,
} from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  PolytechConnector,
  POLYTECH_BASE_URL,
} from "@/lib/connectors/polytech";
import { syncPolytechSupplier } from "@/lib/sync-polytech";

// Allow long sync runs (many linked products × 1 req/sec)
export const maxDuration = 300;

type SupplierRow = typeof suppliers.$inferSelect;

function getPolytechSupplier(): SupplierRow | null {
  return (
    db
      .select()
      .from(suppliers)
      .where(sql`UPPER(${suppliers.code}) = 'POLYTECH'`)
      .limit(1)
      .get() ?? null
  );
}

function getConnectorFromSupplier(supplier: SupplierRow): PolytechConnector {
  const cfg = JSON.parse(supplier.apiConfig || "{}");
  return new PolytechConnector(
    cfg.username || "",
    cfg.baseUrl || POLYTECH_BASE_URL
  );
}

// GET: supplier info
export async function GET() {
  const supplier = getPolytechSupplier();
  if (!supplier) return NextResponse.json({ exists: false });

  const row = db.$client
    .prepare(
      "SELECT COUNT(*) as count FROM product_supplier_links WHERE supplier_id = ? AND is_active = 1"
    )
    .get(supplier.id) as { count: number };

  const latestCatalog = db
    .select()
    .from(supplierCatalogs)
    .where(eq(supplierCatalogs.supplierId, supplier.id))
    .orderBy(desc(supplierCatalogs.importedAt))
    .limit(1)
    .get();

  return NextResponse.json({
    exists: true,
    supplier: {
      id: supplier.id,
      name: supplier.name,
      currency: supplier.currency,
      taxRate: supplier.taxRate,
    },
    linkedProducts: row?.count ?? 0,
    latestSync: latestCatalog
      ? {
          importedAt: latestCatalog.importedAt,
          rowCount: latestCatalog.rowCount,
          linkedCount: latestCatalog.linkedCount,
          status: latestCatalog.status,
        }
      : null,
  });
}

export async function POST(request: NextRequest) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_SYNC_MSG, demo: true });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await request.json()) as any;
    const { action } = body as { action: string };

    // ─── SETUP: create/update the POLYTECH supplier record ─────────────────
    if (action === "setup") {
      const { name, taxRate, token, baseUrl } = body as {
        name?: string;
        taxRate?: number;
        token: string;
        baseUrl?: string;
      };
      if (!token) {
        return NextResponse.json({ error: "Token requerido" }, { status: 400 });
      }
      const apiConfig = JSON.stringify({
        connectorId: "polytech",
        username: token,
        password: "",
        baseUrl: baseUrl || POLYTECH_BASE_URL,
      });

      const existing = getPolytechSupplier();
      if (existing) {
        db.update(suppliers)
          .set({
            name: name || existing.name,
            taxRate: taxRate ?? existing.taxRate,
            apiConfig,
            connectorType: "api",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(suppliers.id, existing.id))
          .run();
        return NextResponse.json({ success: true, id: existing.id });
      } else {
        const created = db
          .insert(suppliers)
          .values({
            code: "POLYTECH",
            name: name || "Polytech",
            currency: "USD",
            taxRate: taxRate ?? 0,
            shippingSurcharge: 0,
            shippingPercent: 0,
            connectorType: "api",
            apiConfig,
            autoSync: false,
            isActive: true,
          })
          .returning()
          .get();
        return NextResponse.json({ success: true, id: created.id });
      }
    }

    // ─── Remaining actions need an existing supplier ────────────────────────
    const supplier = getPolytechSupplier();

    // TEST: accepts either a direct token OR uses stored config
    if (action === "test") {
      const { token, baseUrl } = body as { token?: string; baseUrl?: string };
      const connector = token
        ? new PolytechConnector(token, baseUrl || POLYTECH_BASE_URL)
        : supplier
        ? getConnectorFromSupplier(supplier)
        : null;
      if (!connector) {
        return NextResponse.json(
          { error: "Token no configurado" },
          { status: 400 }
        );
      }
      const ok = await connector.testConnection();
      return NextResponse.json({ success: ok });
    }

    if (!supplier) {
      return NextResponse.json(
        { error: "Proveedor POLYTECH no configurado" },
        { status: 400 }
      );
    }
    const connector = getConnectorFromSupplier(supplier);

    // ─── SEARCH ─────────────────────────────────────────────────────────────
    if (action === "search") {
      const { keyword, page } = body as { keyword?: string; page?: number };
      if (!keyword) {
        return NextResponse.json(
          { error: "keyword requerido" },
          { status: 400 }
        );
      }
      const result = await connector.search(keyword, page ?? 1);

      // Annotate with linked status
      const codes = result.items.map((i) => i.sourceId);
      const linkedMap = new Map<string, number>();
      if (codes.length > 0) {
        const rows = db.$client
          .prepare(
            `SELECT supplier_code, product_id FROM product_supplier_links
             WHERE supplier_id = ? AND supplier_code IN (${codes.map(() => "?").join(",")})`
          )
          .all(supplier.id, ...codes) as {
          supplier_code: string;
          product_id: number;
        }[];
        for (const r of rows) linkedMap.set(r.supplier_code, r.product_id);
      }

      return NextResponse.json({
        ...result,
        items: result.items.map((item) => ({
          ...item,
          linkedProductId: linkedMap.get(item.sourceId) ?? null,
        })),
      });
    }

    // ─── ADD-TO-CATALOG: save a search result as unlinked catalog item ──────
    if (action === "add-to-catalog") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemData = body.item as any;
      if (!itemData?.sourceId) {
        return NextResponse.json({ error: "Item inválido" }, { status: 400 });
      }

      // Reuse today's open "search" catalog or create a new one
      const today = new Date().toISOString().slice(0, 10);
      const todayCatalog = db.$client
        .prepare(
          `SELECT * FROM supplier_catalogs
           WHERE supplier_id = ? AND filename = ? AND status = 'processing'
           LIMIT 1`
        )
        .get(supplier.id, `polytech-search-${today}`) as
        | (typeof supplierCatalogs.$inferSelect)
        | undefined;

      let catalog: typeof supplierCatalogs.$inferSelect;
      if (todayCatalog) {
        catalog = todayCatalog;
      } else {
        catalog = db
          .insert(supplierCatalogs)
          .values({
            supplierId: supplier.id,
            filename: `polytech-search-${today}`,
            rowCount: 0,
            status: "processing",
          })
          .returning()
          .get();
      }

      // Avoid duplicates in this catalog
      const exists = db.$client
        .prepare(
          "SELECT id FROM supplier_catalog_items WHERE catalog_id = ? AND supplier_code = ?"
        )
        .get(catalog.id, itemData.sourceId);
      if (exists) {
        return NextResponse.json({ success: true, alreadyExists: true });
      }

      db.insert(supplierCatalogItems)
        .values({
          catalogId: catalog.id,
          supplierCode: itemData.sourceId,
          description: itemData.description,
          price: itemData.precioSinIva,
          currency: "USD",
          stockAvailable: itemData.stockAvailable,
          rawData: JSON.stringify(itemData.rawData ?? {}),
        })
        .run();

      db.$client
        .prepare(
          "UPDATE supplier_catalogs SET row_count = row_count + 1 WHERE id = ?"
        )
        .run(catalog.id);

      return NextResponse.json({ success: true, catalogId: catalog.id });
    }

    // ─── SYNC: update prices/stock for all linked products ──────────────────
    if (action === "sync") {
      const result = await syncPolytechSupplier(supplier.id);
      return NextResponse.json({
        success: result.status === "completed",
        linked: result.linkedCount,
        total: result.totalItems,
        errors: result.errors,
        message: result.message,
      });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  } catch (error) {
    console.error("Polytech error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
