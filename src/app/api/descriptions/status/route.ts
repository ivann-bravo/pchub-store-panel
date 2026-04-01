import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { db } from "@/lib/db";
import { products, comboTemplates } from "@/lib/db/schema";
import { isNotNull, count } from "drizzle-orm";

export async function GET() {
  const [productTotal] = await db.select({ cnt: count() }).from(products);
  const [productWithDesc] = await db
    .select({ cnt: count() })
    .from(products)
    .where(isNotNull(products.description));

  const [comboTotal] = await db.select({ cnt: count() }).from(comboTemplates);
  const [comboWithDesc] = await db
    .select({ cnt: count() })
    .from(comboTemplates)
    .where(isNotNull(comboTemplates.description));

  return NextResponse.json({
    products: {
      total: productTotal.cnt,
      withDesc: productWithDesc.cnt,
    },
    combos: {
      total: comboTotal.cnt,
      withDesc: comboWithDesc.cnt,
    },
  });
}
