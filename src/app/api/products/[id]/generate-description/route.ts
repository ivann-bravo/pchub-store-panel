import { NextRequest, NextResponse } from "next/server";
import { DEMO_MODE, DEMO_AI_MSG } from "@/lib/demo";
import { db } from "@/lib/db";
import { products, productSupplierLinks, suppliers } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

/**
 * Step 1 — Research real specs using Gemini + Google Search grounding.
 * Searches brand site → distributor site → any online store, in that order.
 * Returns the raw text with found specs, or "SIN DATOS EXACTOS: ..." if nothing found.
 */
async function researchSpecs(
  name: string,
  sku: string | null,
  brand: string | null,
  supplierNames: string[],
  apiKey: string
): Promise<string> {
  const supplierHint = supplierNames.length > 0
    ? `Distribuidores argentinos que lo comercializan: ${supplierNames.join(", ")}.`
    : "";

  const skuLine = sku ? `SKU/Código: ${sku}` : "";
  const brandSite = brand
    ? `Primero buscá en el sitio oficial de ${brand} (ej: ${brand.toLowerCase().replace(/\s/g, "")}.com)`
    : "Primero buscá en el sitio oficial de la marca";

  const prompt = `Necesito las especificaciones técnicas EXACTAS de este producto de hardware para PC:

Nombre exacto: ${name}
${skuLine}
Marca: ${brand ?? "—"}
${supplierHint}

INSTRUCCIONES DE BÚSQUEDA (seguí este orden estrictamente):
1. ${brandSite}. Buscá el modelo exacto "${name}"${sku ? ` o el SKU "${sku}"` : ""}.
2. Si no encontrás el modelo exacto, buscá "${sku ?? name} ${supplierNames[0] ?? ""}" para encontrar la página del distribuidor argentino.
3. Si todavía no encontrás, buscá "${name} especificaciones técnicas" en tiendas online argentinas o internacionales (mercadolibre, amazon, newegg, etc.).

REGLAS CRÍTICAS:
- Reportá ÚNICAMENTE specs que encontraste en los resultados de búsqueda. NO inventes valores.
- Si el nombre tiene variantes (ej: RTX 4060 vs RTX 4060 Ti, A520 vs A520M), NO uses la variante — solo el modelo exacto.
- Incluí todas las specs técnicas relevantes: frecuencia, memoria, velocidad, puertos, dimensiones, consumo, etc.

FORMATO DE RESPUESTA:
Si encontraste specs reales, respondé con:
FUENTE: [URL o nombre del sitio donde encontraste la info]
SPECS:
- [Spec]: [Valor exacto]
- [Spec]: [Valor exacto]
...

Si NO encontraste specs del modelo exacto, respondé con:
SIN DATOS EXACTOS: [breve explicación de qué buscaste y por qué no encontraste]`;

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) return `SIN DATOS EXACTOS: Error en búsqueda (HTTP ${res.status})`;
  const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "SIN DATOS EXACTOS: Sin respuesta de Gemini";
}

/**
 * Step 2 — Generate HTML description from the researched specs.
 * If specs are real, uses only those values. If not, generates a clearly-marked generic description.
 */
function buildDescriptionPrompt(
  name: string,
  sku: string | null,
  brand: string | null,
  category: string | null,
  specs: string
): string {
  const hasRealSpecs = !specs.trimStart().startsWith("SIN DATOS EXACTOS");

  const specsSection = hasRealSpecs
    ? `ESPECIFICACIONES REALES ENCONTRADAS EN LA WEB:
${specs}

REGLAS PARA LAS SPECS:
- Usá ÚNICAMENTE las especificaciones listadas arriba.
- NO agregues specs que no estén en esa lista.
- NO inventes valores. Si no tenés el dato exacto, no lo incluyas.
- Podés reformular los valores para que queden claros (ej: "16 GB DDR5-6000" → "16 GB DDR5 a 6000 MHz").`
    : `AVISO: No se encontraron especificaciones verificadas online para este modelo exacto.
Generá una descripción genérica basada en la categoría y marca, SIN inventar especificaciones técnicas concretas (frecuencias, voltajes, capacidades específicas, etc.).
En el aviso final, aclará que los datos detallados no están disponibles públicamente.`;

  return `Sos redactor de TryHardware (Argentina). Generá una descripción detallada en HTML para WooCommerce.

Producto: ${name}
SKU: ${sku ?? "—"}
Marca: ${brand ?? "—"}
Categoría: ${category ?? "—"}

${specsSection}

FORMATO HTML REQUERIDO (SIN markdown, SIN \`\`\`html, solo HTML puro):
<p>[Párrafo introductorio: 2-3 oraciones sobre el producto y su uso ideal. Mencioná características reales del producto.]</p>
<h6>Especificaciones técnicas</h6>
<ul>
<li><strong>[Spec]:</strong> [Valor exacto de la lista de arriba]</li>
...
</ul>
<h6>Características destacadas</h6>
<ul>
<li><strong>[Característica]:</strong> [Descripción basada en las specs reales]</li>
...
</ul>
<p><em>${hasRealSpecs
  ? "Descripción generada por IA basada en especificaciones oficiales. Puede contener errores menores. Para información completa consultá el sitio del fabricante. Si tenés dudas, consultanos por WhatsApp."
  : `Descripción generada por IA. Los datos detallados de este modelo no están disponibles públicamente al momento. Puede contener errores. Para más información consultá el datasheet del fabricante en su sitio web oficial. Si tenés dudas, consultanos por WhatsApp.`
}</em></p>

Respondé ÚNICAMENTE con el HTML, sin explicaciones, sin texto extra, sin markdown.`;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (DEMO_MODE) {
    return NextResponse.json({ error: "demo_mode", message: DEMO_AI_MSG, demo: true });
  }
  const productId = parseInt(params.id, 10);
  if (isNaN(productId)) {
    return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY no configurada" }, { status: 500 });
  }

  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) {
    return NextResponse.json({ error: "Producto no encontrado" }, { status: 404 });
  }

  // Get supplier names for better search context
  const supplierRows = db
    .select({ name: suppliers.name })
    .from(productSupplierLinks)
    .innerJoin(suppliers, eq(suppliers.id, productSupplierLinks.supplierId))
    .where(eq(productSupplierLinks.productId, productId))
    .all();
  const supplierNames = supplierRows.map((r) => r.name);

  // ── Step 1: Research real specs via Google Search ──────────────────────────
  const specs = await researchSpecs(
    product.name,
    product.sku,
    product.brand,
    supplierNames,
    apiKey
  );
  console.log(`[generate-description] product=${productId} specs found: ${specs.slice(0, 120)}...`);

  // ── Step 2: Generate description from verified specs ──────────────────────
  const prompt = buildDescriptionPrompt(
    product.name,
    product.sku,
    product.brand,
    product.category,
    specs
  );

  const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!geminiRes.ok) {
    const errBody = await geminiRes.text();
    console.error("Gemini API error:", errBody);
    let geminiMsg = "";
    try { geminiMsg = (JSON.parse(errBody) as { error?: { message?: string } }).error?.message ?? errBody; } catch { geminiMsg = errBody; }
    return NextResponse.json({ error: `Gemini ${geminiRes.status}: ${geminiMsg}` }, { status: 502 });
  }

  const geminiData = await geminiRes.json() as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  };
  const description = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!description) {
    return NextResponse.json({ error: "Gemini no devolvió texto" }, { status: 502 });
  }

  // Save to DB
  db.update(products)
    .set({ description, updatedAt: sql`(datetime('now'))` })
    .where(eq(products.id, productId))
    .run();

  return NextResponse.json({ description });
}
