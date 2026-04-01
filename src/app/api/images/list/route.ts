import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";
import { eq, like, sql, and, isNull } from "drizzle-orm";

/**
 * GET /api/images/list
 * Query params:
 *   status?: "ok"|"needs_conversion"|"bad_quality"|"no_image"|"unchecked"
 *   search?: string
 *   page?: number (1-based)
 *   limit?: number (default 50)
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "all";
  const search = searchParams.get("search") ?? "";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"));
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (search) {
    conditions.push(like(products.name, `%${search}%`));
  }

  if (status === "unchecked") {
    conditions.push(isNull(products.imageAuditStatus));
  } else if (status !== "all") {
    conditions.push(eq(products.imageAuditStatus, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        imageUrl: products.imageUrl,
        galleryImages: products.galleryImages,
        woocommerceId: products.woocommerceId,
        imageAuditStatus: products.imageAuditStatus,
        imageAuditData: products.imageAuditData,
        wooMainImageAttachmentId: products.wooMainImageAttachmentId,
        wooGalleryAttachmentIds: products.wooGalleryAttachmentIds,
      })
      .from(products)
      .where(where)
      .orderBy(
        // Sort order: bad_quality → needs_conversion → no_image → ok → unchecked
        sql`CASE image_audit_status
          WHEN 'bad_quality'       THEN 1
          WHEN 'needs_conversion'  THEN 2
          WHEN 'no_image'          THEN 3
          WHEN 'ok'                THEN 4
          WHEN 'listo'             THEN 5
          ELSE                          6
        END`,
        products.name,
      )
      .limit(limit)
      .offset(offset),

    db
      .select({ total: sql<number>`COUNT(*)` })
      .from(products)
      .where(where),
  ]);

  return NextResponse.json({
    rows,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
