import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_AI_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { comboTemplates, comboSlots, products } from "@/lib/db/schema";
import { eq, asc, inArray, sql } from "drizzle-orm";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function buildPrompt(
  name: string,
  sku: string,
  notes: string | null,
  totalPrice: number | null,
  slots: { slotName: string; quantity: number; productName: string | null }[]
): string {
  const componentLines = slots
    .map((s) => {
      const product = s.productName ?? `[${s.slotName}]`;
      return s.quantity > 1 ? `${s.quantity}x ${product}` : product;
    })
    .join("\n");

  const priceInfo = totalPrice != null
    ? `Precio total estimado: $${totalPrice.toLocaleString("es-AR", { maximumFractionDigits: 0 })} ARS`
    : "";

  return `Sos redactor de TryHardware (Argentina). Generá una descripción HTML para WooCommerce de esta PC armada o combo.

**DATOS DE LA PC:**
Nombre: ${name}
SKU: ${sku}
${notes ? `Notas: ${notes}` : ""}
${priceInfo}

Componentes:
${componentLines}

**FORMATO HTML REQUERIDO** (sin markdown, sin \`\`\`html, solo HTML puro):
<p>[Párrafo de introducción: 2-3 oraciones sobre el uso ideal — gaming, oficina, diseño, edición, etc. Basate en los componentes.]</p>
<h6>Componentes incluidos</h6>
<ul>
[Un <li> por componente]
</ul>
<p>[Párrafo de cierre: mencioná que los componentes pueden variar según el stock disponible al momento de la compra, que el cliente puede armar su propia PC a medida en <a href="https://pchub.com.ar/arma-tu-pc">pchub.com.ar/arma-tu-pc</a>, y que pueden consultarnos por WhatsApp para pedidos personalizados.]</p>
<p><em>Descripción generada por IA. Puede contener errores. Para más información, consultá el datasheet del fabricante o consultanos por WhatsApp.</em></p>

**INSTRUCCIONES:**
- Español argentino, tono profesional pero cercano.
- Usá <strong> para resaltar valores clave (ej: <strong>16GB DDR4</strong>).
- No menciones precios específicos.
- Respondé ÚNICAMENTE con el HTML, sin explicaciones ni texto extra.`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_AI_MSG, demo: true });
  }
  const id = parseInt(params.id, 10);
  if (isNaN(id)) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY no configurada" }, { status: 500 });
  }

  // Load combo with resolved slot product names
  const template = db.select().from(comboTemplates).where(eq(comboTemplates.id, id)).get();
  if (!template) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const slots = db
    .select()
    .from(comboSlots)
    .where(eq(comboSlots.templateId, id))
    .orderBy(asc(comboSlots.sortOrder))
    .all();

  const resolvedIds = slots
    .map((s) => s.resolvedProductId)
    .filter((pid): pid is number => pid != null);
  const productNameMap: Record<number, string> = {};
  if (resolvedIds.length > 0) {
    const rows = db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, resolvedIds))
      .all();
    for (const row of rows) productNameMap[row.id] = row.name;
  }

  const slotData = slots.map((s) => ({
    slotName: s.slotName,
    quantity: s.quantity,
    productName: s.resolvedProductId != null ? (productNameMap[s.resolvedProductId] ?? null) : null,
  }));

  const prompt = buildPrompt(
    template.name,
    template.sku,
    template.notes,
    template.lastTotalPrice,
    slotData
  );

  // Call Gemini Flash
  const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!geminiRes.ok) {
    const errBody = await geminiRes.text();
    console.error("Gemini API error:", errBody);
    let geminiMsg = "";
    try { geminiMsg = (JSON.parse(errBody) as { error?: { message?: string } }).error?.message ?? errBody; } catch { geminiMsg = errBody; }
    return NextResponse.json(
      { error: `Gemini ${geminiRes.status}: ${geminiMsg}` },
      { status: 502 }
    );
  }

  const geminiData = await geminiRes.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const description = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const finishReason = geminiData.candidates?.[0]?.finishReason ?? "";
  if (!description) {
    return NextResponse.json({ error: "Gemini no devolvió texto" }, { status: 502 });
  }
  if (finishReason === "MAX_TOKENS") {
    console.warn(`[combo ${id}] Gemini truncated (MAX_TOKENS) — increase maxOutputTokens`);
  }

  // Save to DB
  db.update(comboTemplates)
    .set({ description, updatedAt: sql`(datetime('now'))` })
    .where(eq(comboTemplates.id, id))
    .run();

  return NextResponse.json({ description });
}
