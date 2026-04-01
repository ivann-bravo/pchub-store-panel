import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { analyzeImageUrl } from "@/lib/image-utils";

const BATCH_PARALLEL = 8; // concurrent image downloads per chunk

/**
 * POST /api/images/audit/chunk
 * Body: { offset: number; limit: number; force?: boolean }
 *
 * Analyzes a slice of products and saves audit results to DB.
 * Designed to be called repeatedly by the client until offset >= total.
 * `force=true` re-analyzes products that already have a result.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { offset = 0, limit = 50, force = false } = await request.json() as {
    offset?: number;
    limit?: number;
    force?: boolean;
  };

  // Total product count
  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products);

  // Fetch the slice — skip already-audited unless force=true
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      imageUrl: products.imageUrl,
      imageAuditStatus: products.imageAuditStatus,
      imageAuditData: products.imageAuditData,
    })
    .from(products)
    .orderBy(products.id)
    .limit(limit)
    .offset(offset);

  // Filter: skip already-audited rows unless force. "listo" is never re-audited (audit would downgrade it to "ok").
  const toProcess = force
    ? rows.filter((r) => r.imageAuditStatus !== "listo")
    : rows.filter((r) => !r.imageAuditStatus);

  // Process in parallel batches of BATCH_PARALLEL
  const results: Array<{ id: number; status: string }> = [];

  for (let i = 0; i < toProcess.length; i += BATCH_PARALLEL) {
    const batch = toProcess.slice(i, i + BATCH_PARALLEL);

    await Promise.all(
      batch.map(async (row) => {
        if (!row.imageUrl) {
          // No image at all
          await db
            .update(products)
            .set({
              imageAuditStatus: "no_image",
              imageAuditData: JSON.stringify({
                width: 0,
                height: 0,
                format: "none",
                isWebP: false,
                hasWhiteBg: false,
                checkedAt: new Date().toISOString(),
              }),
            })
            .where(eq(products.id, row.id));
          results.push({ id: row.id, status: "no_image" });
          return;
        }

        // Use the first URL (imageUrl may be comma-separated)
        const firstUrl = row.imageUrl.split(",")[0].trim();
        const audit = await analyzeImageUrl(firstUrl);

        await db
          .update(products)
          .set({
            imageAuditStatus: audit.status,
            imageAuditData: JSON.stringify(audit),
          })
          .where(eq(products.id, row.id));

        results.push({ id: row.id, status: audit.status });
      }),
    );
  }

  // Return updated counts from DB
  const counts = await db
    .select({
      status: products.imageAuditStatus,
      count: sql<number>`COUNT(*)`,
    })
    .from(products)
    .groupBy(products.imageAuditStatus);

  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c.status ?? "unchecked"] = c.count;
  }

  const audited =
    (countMap["listo"] ?? 0) +
    (countMap["ok"] ?? 0) +
    (countMap["needs_conversion"] ?? 0) +
    (countMap["bad_quality"] ?? 0) +
    (countMap["no_image"] ?? 0);

  return NextResponse.json({
    processedInChunk: results.length,
    skippedInChunk: toProcess.length === 0 ? rows.length : 0,
    nextOffset: offset + limit,
    total,
    audited,
    counts: {
      listo: countMap["listo"] ?? 0,
      ok: countMap["ok"] ?? 0,
      needs_conversion: countMap["needs_conversion"] ?? 0,
      bad_quality: countMap["bad_quality"] ?? 0,
      no_image: countMap["no_image"] ?? 0,
      unchecked: total - audited,
    },
  });
}

/**
 * GET /api/images/audit/chunk
 * Returns current audit status counts without processing anything.
 */
export async function GET() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(products);

  const counts = await db
    .select({
      status: products.imageAuditStatus,
      count: sql<number>`COUNT(*)`,
    })
    .from(products)
    .groupBy(products.imageAuditStatus);

  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c.status ?? "unchecked"] = c.count;
  }

  const audited =
    (countMap["listo"] ?? 0) +
    (countMap["ok"] ?? 0) +
    (countMap["needs_conversion"] ?? 0) +
    (countMap["bad_quality"] ?? 0) +
    (countMap["no_image"] ?? 0);

  // Also check if product has no_image but gained an imageUrl since last audit
  const staleNoImage = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(products)
    .where(
      sql`image_audit_status = 'no_image' AND image_url IS NOT NULL AND image_url != ''`,
    );

  return NextResponse.json({
    total,
    audited,
    staleNoImage: staleNoImage[0]?.count ?? 0,
    counts: {
      listo: countMap["listo"] ?? 0,
      ok: countMap["ok"] ?? 0,
      needs_conversion: countMap["needs_conversion"] ?? 0,
      bad_quality: countMap["bad_quality"] ?? 0,
      no_image: countMap["no_image"] ?? 0,
      unchecked: total - audited,
    },
  });
}
