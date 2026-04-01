/**
 * React-PDF component for quote presupuestos — PCHub Argentina brand design.
 * Server-side only — never import from client components.
 */
import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface PdfItem {
  itemName: string;
  quantity: number;
  isOptional: boolean;
  itemType: "auto" | "fixed" | "text";
  resolvedProductName: string | null;
  resolvedProductSku: string | null;
  resolvedImageUrl: string | null;  // should be base64 data URI for reliable rendering
  resolvedPrice: number | null;
  manualPrice: number | null;
  textPrice: number | null;
  textSku: string | null;
}

export interface PdfQuote {
  id: number;
  title: string;
  notes: string | null;
  resolvedTotal: number | null;
  items: PdfItem[];
}

export interface PdfCompanyInfo {
  razonSocial: string;
  cuit: string;
  domicilio: string;
  ivaCondition: string;
  ingresosBrutos: string;
  inicioActividades: string;
  logoUrl: string | null;
}

// ── Brand tokens ──────────────────────────────────────────────────────────────
const ORANGE   = "#FF4805";   // hsl(16 100% 51%) — primary
const DARK     = "#111827";   // almost black
const GRAY     = "#6B7280";
const LIGHT    = "#F9FAFB";
const BORDER   = "#E5E7EB";
const WHITE    = "#FFFFFF";

// ── Price helpers ─────────────────────────────────────────────────────────────

/** Round price to nearest integer ending in 9, rounding up */
function roundToNine(price: number): number {
  const n = Math.ceil(price);
  return Math.ceil((n - 9) / 10) * 10 + 9;
}

function fmt(n: number): string {
  return `$ ${roundToNine(n).toLocaleString("es-AR")}`;
}

function getEffectivePrice(item: PdfItem): number | null {
  if (item.manualPrice != null) return item.manualPrice;
  if (item.itemType === "text") return item.textPrice;
  return item.resolvedPrice;
}

function getDisplayName(item: PdfItem): string {
  if (item.resolvedProductName) return item.resolvedProductName;
  if (item.textSku && item.textSku !== "ARMADO") return `${item.itemName} (${item.textSku})`;
  return item.itemName;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 8.5,
    color: DARK,
    backgroundColor: WHITE,
    paddingTop: 0,
    paddingBottom: 32,
    paddingHorizontal: 0,
  },

  // ─── Header band ────────────────────────────────────────────────────────────
  headerBand: {
    backgroundColor: DARK,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 0,
  },
  logoBox: { height: 48, width: 180 },
  logo: { height: 48, width: 180, objectFit: "contain" },
  logoText: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: ORANGE,
    letterSpacing: 2,
  },
  headerRight: { alignItems: "flex-end" },
  docTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: ORANGE,
    letterSpacing: 1,
  },
  docSubtitle: {
    fontSize: 7,
    color: "#9CA3AF",
    marginTop: 2,
    letterSpacing: 0.5,
  },

  // ─── Orange accent strip ─────────────────────────────────────────────────────
  accentStrip: {
    height: 3,
    backgroundColor: ORANGE,
  },

  // ─── Content area ───────────────────────────────────────────────────────────
  content: {
    paddingHorizontal: 24,
    paddingTop: 14,
  },

  // ─── Legal block ────────────────────────────────────────────────────────────
  legalBlock: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  legalCol: { flex: 1 },
  legalRow: { flexDirection: "row", marginBottom: 3 },
  legalLabel: {
    fontSize: 7,
    color: GRAY,
    width: 90,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
  },
  legalValue: { fontSize: 7.5, color: DARK, flex: 1 },
  legalValueOrange: { fontSize: 7.5, color: ORANGE, fontFamily: "Helvetica-Bold", flex: 1 },

  // ─── Quote banner ─────────────────────────────────────────────────────────
  quoteBanner: {
    backgroundColor: ORANGE,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  quoteBannerTitle: {
    fontSize: 12,
    color: WHITE,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
  },
  quoteBannerSub: { fontSize: 7.5, color: "#FFE4D9" },
  quoteNotes: {
    fontSize: 8,
    color: GRAY,
    marginBottom: 8,
    fontStyle: "italic",
    paddingHorizontal: 2,
  },

  // ─── Table ───────────────────────────────────────────────────────────────────
  tableHeader: {
    flexDirection: "row",
    backgroundColor: DARK,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  thText: {
    fontSize: 7,
    color: WHITE,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  tableRow: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: BORDER,
    alignItems: "center",
    minHeight: 48,
  },
  tableRowAlt: { backgroundColor: LIGHT },

  colThumb: { width: 46, marginRight: 10 },
  thumb: { width: 42, height: 42, objectFit: "contain" },
  thumbPlaceholder: {
    width: 42,
    height: 42,
    backgroundColor: BORDER,
    borderRadius: 3,
  },
  colName: { flex: 1 },
  colQty: { width: 36, textAlign: "center" },
  colUnitPrice: { width: 78, textAlign: "right" },
  colSubtotal: { width: 86, textAlign: "right" },

  cellMain: { fontSize: 9, color: DARK, fontFamily: "Helvetica-Bold" },
  cellSub: { fontSize: 7, color: GRAY, marginTop: 2 },
  optionalLabel: {
    fontSize: 6.5,
    color: ORANGE,
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
  },
  cellQty: { fontSize: 9, color: DARK, textAlign: "center" },
  cellPrice: { fontSize: 9.5, color: DARK, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cellPriceGray: { fontSize: 8.5, color: GRAY, textAlign: "right", fontStyle: "italic" },
  cellPriceStrike: {
    fontSize: 8,
    color: GRAY,
    textAlign: "right",
    textDecoration: "line-through",
  },
  cellSubtotal: { fontSize: 10, color: DARK, textAlign: "right", fontFamily: "Helvetica-Bold" },
  cellSubtotalGray: { fontSize: 8.5, color: GRAY, textAlign: "right", fontStyle: "italic" },

  // ─── Totals ──────────────────────────────────────────────────────────────────
  totalsContainer: {
    marginTop: 12,
    alignItems: "flex-end",
    paddingRight: 0,
  },
  totalLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    marginBottom: 0,
  },
  totalBox: {
    backgroundColor: ORANGE,
    paddingVertical: 7,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: 260,
  },
  totalBoxLabel: {
    fontSize: 10,
    color: WHITE,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
  },
  totalBoxValue: {
    fontSize: 14,
    color: WHITE,
    fontFamily: "Helvetica-Bold",
  },
  totalNote: {
    fontSize: 7,
    color: GRAY,
    marginTop: 4,
    textAlign: "right",
    width: 260,
  },

  // ─── Footer ──────────────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: DARK,
    paddingVertical: 10,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  footerLine: {
    fontSize: 8,
    color: "#9CA3AF",
    textAlign: "center",
    fontStyle: "italic",
    marginBottom: 3,
  },
});

// ── Page component ────────────────────────────────────────────────────────────
interface QuotePageProps {
  quote: PdfQuote;
  company: PdfCompanyInfo;
  emissionDate: string;
  exchangeRate: number | null;
}

function QuotePage({ quote, company, emissionDate, exchangeRate }: QuotePageProps) {
  const nonOptional = quote.items.filter((i) => !i.isOptional);
  const total = nonOptional.reduce((sum, item) => {
    const p = getEffectivePrice(item);
    return sum + (p != null ? p * item.quantity : 0);
  }, 0);

  return (
    <Page size="A4" style={S.page}>
      {/* ── Header band ───────────────────────────────── */}
      <View style={S.headerBand}>
        <View style={S.logoBox}>
          {company.logoUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={company.logoUrl} style={S.logo} />
          ) : (
            <Text style={S.logoText}>TRY</Text>
          )}
        </View>
        <View style={S.headerRight}>
          <Text style={S.docTitle}>PRESUPUESTO</Text>
          <Text style={S.docSubtitle}>X / NO VÁLIDO COMO FACTURA</Text>
        </View>
      </View>
      <View style={S.accentStrip} />

      <View style={S.content}>
        {/* ── Legal block ─────────────────────────────── */}
        <View style={S.legalBlock}>
          <View style={S.legalCol}>
            {[
              ["Razón Social", company.razonSocial || "PCHub Argentina"],
              ["Domicilio",    company.domicilio || "—"],
              ["CUIT",         company.cuit || "—"],
              ["Cond. IVA",    company.ivaCondition || "—"],
            ].map(([label, value]) => (
              <View key={label} style={S.legalRow}>
                <Text style={S.legalLabel}>{label}</Text>
                <Text style={S.legalValue}>{value}</Text>
              </View>
            ))}
          </View>
          <View style={S.legalCol}>
            {[
              ["Ing. Brutos",       company.ingresosBrutos || "—"],
              ["Inicio Actividades", company.inicioActividades || "—"],
              ["Fecha emisión",      emissionDate],
              ...(exchangeRate ? [["TC BNA (ref.)", `$ ${exchangeRate.toFixed(2)}`] as [string, string]] : []),
            ].map(([label, value]) => (
              <View key={label} style={S.legalRow}>
                <Text style={S.legalLabel}>{label}</Text>
                <Text style={label === "Fecha emisión" ? S.legalValueOrange : S.legalValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Quote banner ────────────────────────────── */}
        <View style={S.quoteBanner}>
          <Text style={S.quoteBannerTitle}>{quote.title}</Text>
          {quote.resolvedTotal != null && (
            <Text style={S.quoteBannerSub}>Total: {fmt(quote.resolvedTotal)}</Text>
          )}
        </View>

        {quote.notes ? <Text style={S.quoteNotes}>{quote.notes}</Text> : null}

        {/* ── Table header ────────────────────────────── */}
        <View style={S.tableHeader}>
          <View style={S.colThumb} />
          <Text style={[S.thText, S.colName]}>Producto</Text>
          <Text style={[S.thText, S.colQty]}>Cant.</Text>
          <Text style={[S.thText, S.colUnitPrice]}>Precio unit.</Text>
          <Text style={[S.thText, S.colSubtotal]}>Subtotal</Text>
        </View>

        {/* ── Rows ──────────────────────────────────────── */}
        {quote.items.map((item, idx) => {
          const effectivePrice = getEffectivePrice(item);
          const displayName = getDisplayName(item);
          const isAlt = idx % 2 === 1;

          return (
            <View
              key={idx}
              style={[
                S.tableRow,
                isAlt ? S.tableRowAlt : {},
              ]}
            >
              {/* Thumbnail */}
              <View style={S.colThumb}>
                {item.resolvedImageUrl ? (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <Image src={item.resolvedImageUrl} style={S.thumb} />
                ) : (
                  <View style={S.thumbPlaceholder} />
                )}
              </View>

              {/* Name + SKU */}
              <View style={S.colName}>
                <Text style={S.cellMain}>{displayName}</Text>
                {item.resolvedProductSku && (
                  <Text style={S.cellSub}>{item.resolvedProductSku}</Text>
                )}
                {item.textSku && item.textSku !== "ARMADO" && !item.resolvedProductSku && (
                  <Text style={S.cellSub}>{item.textSku}</Text>
                )}
                {item.isOptional && (
                  <Text style={S.optionalLabel}>OPCIONAL</Text>
                )}
              </View>

              {/* Qty */}
              <Text style={[S.cellQty, S.colQty]}>{item.quantity}</Text>

              {/* Unit price */}
              <View style={S.colUnitPrice}>
                {effectivePrice != null ? (
                  <>
                    {item.manualPrice != null &&
                      item.resolvedPrice != null &&
                      item.manualPrice !== item.resolvedPrice && (
                        <Text style={S.cellPriceStrike}>{fmt(item.resolvedPrice)}</Text>
                      )}
                    <Text style={S.cellPrice}>{fmt(effectivePrice)}</Text>
                  </>
                ) : (
                  <Text style={S.cellPriceGray}>A confirmar</Text>
                )}
              </View>

              {/* Subtotal */}
              <View style={S.colSubtotal}>
                {effectivePrice != null ? (
                  <Text style={S.cellSubtotal}>{fmt(effectivePrice * item.quantity)}</Text>
                ) : (
                  <Text style={S.cellSubtotalGray}>—</Text>
                )}
              </View>
            </View>
          );
        })}

        {/* ── Totals ──────────────────────────────────── */}
        <View style={S.totalsContainer}>
          <View style={S.totalBox}>
            <Text style={S.totalBoxLabel}>TOTAL AL CONTADO</Text>
            <Text style={S.totalBoxValue}>{fmt(total)}</Text>
          </View>
          {quote.items.some((i) => i.isOptional) && (
            <Text style={S.totalNote}>* El total no incluye ítems marcados como opcionales</Text>
          )}
        </View>
      </View>

      {/* ── Footer ────────────────────────────────────── */}
      <View style={S.footer} fixed>
        <Text style={S.footerLine}>
          {exchangeRate
            ? `Valores actualizados a TC BNA actual - $${Math.round(exchangeRate).toLocaleString("es-AR")}`
            : "Valores actualizados al momento de emisión"}
        </Text>
        <Text style={S.footerLine}>Se tomará la cotización al momento del pago</Text>
        <Text style={S.footerLine}>Este presupuesto no reserva stock</Text>
      </View>
    </Page>
  );
}

// ── Document ──────────────────────────────────────────────────────────────────
interface QuoteDocumentProps {
  quotes: PdfQuote[];
  company: PdfCompanyInfo;
  emissionDate: string;
  exchangeRate: number | null;
}

export function QuoteDocument({ quotes: quoteList, company, emissionDate, exchangeRate }: QuoteDocumentProps) {
  return (
    <Document title="Presupuesto" author={company.razonSocial || "PCHub Argentina"}>
      {quoteList.map((q) => (
        <QuotePage
          key={q.id}
          quote={q}
          company={company}
          emissionDate={emissionDate}
          exchangeRate={exchangeRate}
        />
      ))}
    </Document>
  );
}
