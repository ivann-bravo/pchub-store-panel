import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { quotes, quoteItems } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function checkAuth() {
  const session = await getServerSession(authOptions);
  return session != null;
}

const PC_TEMPLATE = [
  { sortOrder: 0, itemName: "Procesador",       itemType: "auto" as const, isOptional: false },
  { sortOrder: 1, itemName: "Cooler",            itemType: "auto" as const, isOptional: true  },
  { sortOrder: 2, itemName: "Motherboard",       itemType: "auto" as const, isOptional: false },
  { sortOrder: 3, itemName: "Memoria RAM",       itemType: "auto" as const, isOptional: false },
  { sortOrder: 4, itemName: "SSD",               itemType: "auto" as const, isOptional: false },
  { sortOrder: 5, itemName: "Placa de Video",    itemType: "auto" as const, isOptional: true  },
  { sortOrder: 6, itemName: "Fuente",            itemType: "auto" as const, isOptional: false },
  { sortOrder: 7, itemName: "Gabinete",          itemType: "auto" as const, isOptional: false },
  { sortOrder: 8, itemName: "Service / Armado",  itemType: "text" as const, isOptional: false, textSku: "ARMADO", textPrice: 0 },
];

// POST /api/quotes/[id]/apply-pc-template
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!await checkAuth()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
  if (!quote) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.delete(quoteItems).where(eq(quoteItems.quoteId, id)).run();

  for (const slot of PC_TEMPLATE) {
    db.insert(quoteItems).values({
      quoteId: id,
      sortOrder: slot.sortOrder,
      itemName: slot.itemName,
      quantity: 1,
      isOptional: slot.isOptional,
      itemType: slot.itemType,
      textSku: "textSku" in slot ? slot.textSku : null,
      textPrice: "textPrice" in slot ? slot.textPrice : null,
    }).run();
  }

  db.update(quotes).set({ updatedAt: new Date().toISOString() }).where(eq(quotes.id, id)).run();

  const items = db.select().from(quoteItems).where(eq(quoteItems.quoteId, id)).all();
  return NextResponse.json({ ok: true, items });
}
