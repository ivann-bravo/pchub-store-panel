"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Tag,
  AlertTriangle,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { formatARS } from "@/lib/number-format";
import type { Product } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PricingSettings {
  globalMarkup: number;
  offerMode: "normal" | "event";
  offerGlobalStart: string;
  offerGlobalEnd: string;
  preview: {
    eligibleForMarkup: number;
    currentlyOnOffer: number;
    ownStockWithoutPrice: number;
    discountDistribution: { pct: number; count: number }[];
  };
  stockAlerts: {
    id: number;
    name: string;
    sku: string | null;
    category: string | null;
    localStock: number;
  }[];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function PricingPage() {
  return (
    <Suspense fallback={<PricingLoadingSkeleton />}>
      <PricingContent />
    </Suspense>
  );
}

function PricingLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader title="Pricing" breadcrumbs={[{ label: "Pricing" }]} />
      <Card>
        <CardContent className="pt-4">
          <Skeleton className="h-10 w-full max-w-md" />
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Markup Section ────────────────────────────────────────────────────────────

function MarkupSection({
  settings,
  onSettingsChange,
  onApplyMarkup,
}: {
  settings: PricingSettings;
  onSettingsChange: (s: Partial<PricingSettings>) => void;
  onApplyMarkup: () => Promise<void>;
}) {
  const [markupInput, setMarkupInput] = useState(String(settings.globalMarkup));
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<{ markup: { updated: number }; offers: { offersAdded: number; offersRemoved: number; groups: number } } | null>(null);

  const handleSaveMarkup = async () => {
    const val = parseFloat(markupInput);
    if (isNaN(val) || val <= 0) return;
    await fetch("/api/pricing/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ globalMarkup: val }),
    });
    onSettingsChange({ globalMarkup: val });
  };

  const handleApply = async () => {
    setApplying(true);
    setResult(null);
    try {
      const res = await fetch("/api/pricing/apply-markup", { method: "POST" });
      const data = await res.json();
      setResult(data);
      await onApplyMarkup();
    } finally {
      setApplying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Markup Global
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Multiplicador de precio</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="1"
                max="5"
                value={markupInput}
                onChange={(e) => setMarkupInput(e.target.value)}
                className="w-28"
              />
              <Button variant="outline" size="sm" onClick={handleSaveMarkup}>
                Guardar
              </Button>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{settings.preview.eligibleForMarkup.toLocaleString()}</span> productos se actualizarán
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          Excluidos: marca Evolabs, SKU PCTRY*, productos con markup=1.0 (precio especial)
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleApply} disabled={applying}>
            {applying && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Aplicar markup a todos los productos
          </Button>
          {result && (
            <p className="text-sm text-muted-foreground">
              ✓ {result.markup.updated} actualizados · {result.offers.offersAdded} ofertas nuevas · {result.offers.offersRemoved} quitadas · {result.offers.groups} grupos
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Offer Engine Section ─────────────────────────────────────────────────────

function OfferEngineSection({
  settings,
  onRefresh,
}: {
  settings: PricingSettings;
  onRefresh: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"normal" | "event">(settings.offerMode);
  const [startDate, setStartDate] = useState(settings.offerGlobalStart);
  const [endDate, setEndDate] = useState(settings.offerGlobalEnd);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ offersAdded: number; offersRemoved: number; groups: number } | null>(null);

  const handleSaveConfig = async () => {
    await fetch("/api/pricing/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offerMode: mode,
        offerGlobalStart: startDate,
        offerGlobalEnd: endDate,
      }),
    });
  };

  const handleRunOffers = async () => {
    setRunning(true);
    setResult(null);
    try {
      await handleSaveConfig();
      const res = await fetch("/api/pricing/run-offers", { method: "POST" });
      const data = await res.json();
      setResult(data);
      await onRefresh();
    } finally {
      setRunning(false);
    }
  };

  const dist = settings.preview.discountDistribution;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Tag className="h-4 w-4" />
          Motor de Ofertas
          <Badge variant="secondary">{settings.preview.currentlyOnOffer} activas</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Modo:</span>
          <Button
            variant={mode === "normal" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("normal")}
          >
            Normal
          </Button>
          <Button
            variant={mode === "event" ? "default" : "outline"}
            size="sm"
            onClick={() => setMode("event")}
          >
            Evento
          </Button>
          <span className="text-xs text-muted-foreground">
            {mode === "normal"
              ? "Cap 40% · umbral = promedio del grupo"
              : "Cap 65% · umbral = promedio + 10%"}
          </span>
        </div>

        {/* Date pickers */}
        <div className="flex items-center gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Inicio de oferta</p>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Fin de oferta</p>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
            />
          </div>
        </div>

        {/* Run button + result */}
        <div className="flex items-center gap-3">
          <Button onClick={handleRunOffers} disabled={running}>
            {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Recalcular ofertas ahora
          </Button>
          {result && (
            <p className="text-sm text-muted-foreground">
              ✓ {result.groups} grupos · +{result.offersAdded} ofertas · -{result.offersRemoved} quitadas
            </p>
          )}
        </div>

        {/* Distribution table */}
        {dist.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-2 pl-3">Descuento</th>
                  <th className="text-right p-2 pr-3">Productos</th>
                </tr>
              </thead>
              <tbody>
                {dist.map((d) => (
                  <tr key={d.pct} className="border-b last:border-0">
                    <td className="p-2 pl-3">
                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                        {d.pct}% OFF
                      </Badge>
                    </td>
                    <td className="p-2 pr-3 text-right font-medium">{d.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Alerts Section ────────────────────────────────────────────────────────────

function AlertsSection({
  alerts,
}: {
  alerts: PricingSettings["stockAlerts"];
}) {
  if (alerts.length === 0) return null;

  return (
    <Card className="border-orange-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-orange-700">
          <AlertTriangle className="h-4 w-4" />
          Stock Propio sin Precio ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">Stock</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((p) => (
              <TableRow
                key={p.id}
                className="cursor-pointer hover:bg-muted/50"
              >
                <TableCell>
                  <Link
                    href={`/products/${p.id}`}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {p.sku || "-"}
                </TableCell>
                <TableCell className="text-sm">{p.category || "-"}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="destructive">{p.localStock}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function PricingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace("/pricing/alerts");
    }
  }, [session, status, router]);

  const [products, setProducts] = useState<(Product & { bestPrice?: number; bestSupplier?: string })[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings | null>(null);

  const page = parseInt(searchParams.get("page") || "1");
  const search = searchParams.get("search") || "";
  const [searchInput, setSearchInput] = useState(search);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: "50", hasPrice: "true" });
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      setProducts(data.products || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const fetchPricingSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/pricing/settings");
      const data = await res.json();
      setPricingSettings(data);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    fetchPricingSettings();
  }, [fetchPricingSettings]);

  const totalPages = Math.ceil(total / 50);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    router.push(`/pricing?${params}`);
  };

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pricing"
        breadcrumbs={[{ label: "Pricing" }]}
        description="Markup global, motor de ofertas y análisis de precios"
        actions={
          <Link href="/pricing/exchange-rates">
            <Button variant="outline">
              <DollarSign className="h-4 w-4 mr-1" /> Cotización USD
            </Button>
          </Link>
        }
      />

      {/* ── Pricing engine sections ── */}
      {pricingSettings ? (
        <>
          <MarkupSection
            settings={pricingSettings}
            onSettingsChange={(partial) =>
              setPricingSettings((s) => s ? { ...s, ...partial } : s)
            }
            onApplyMarkup={async () => {
              await fetchPricingSettings();
              await fetchProducts();
            }}
          />
          <OfferEngineSection
            settings={pricingSettings}
            onRefresh={async () => {
              await fetchPricingSettings();
              await fetchProducts();
            }}
          />
          <AlertsSection alerts={pricingSettings.stockAlerts} />
        </>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      )}

      {/* ── Product analysis table ── */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Análisis de Precios</h2>
        <p className="text-sm text-muted-foreground">Revisá márgenes y precios de venta por producto</p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <Input
              placeholder="Buscar producto..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                updateParams({ search: searchInput, page: "1" })
              }
              className="max-w-md"
            />
            <Button
              onClick={() => updateParams({ search: searchInput, page: "1" })}
              variant="secondary"
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Marca</TableHead>
                <TableHead className="text-right">Costo</TableHead>
                <TableHead className="text-center">Markup</TableHead>
                <TableHead className="text-center">IVA</TableHead>
                <TableHead className="text-right">PV Regular</TableHead>
                <TableHead className="text-right">PV Oferta</TableHead>
                <TableHead className="text-right">Margen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="p-0">
                    <EmptyState
                      icon={DollarSign}
                      title="No hay productos con precio"
                      description="Importa precios de proveedores para ver el análisis de márgenes."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                products.map((p) => {
                  const cost =
                    (p as unknown as { bestPrice?: number }).bestPrice || 0;
                  const pvSinIva = cost * p.markupRegular;
                  const pvRegular = pvSinIva * (1 + p.ivaRate);
                  const pvOferta = p.markupOffer
                    ? cost * p.markupOffer * (1 + p.ivaRate)
                    : null;
                  const margen = pvSinIva - cost;

                  return (
                    <TableRow
                      key={p.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) window.open(`/products/${p.id}`, "_blank");
                        else router.push(`/products/${p.id}`);
                      }}
                    >
                      <TableCell className="max-w-[300px] font-medium">
                        <Link
                          href={`/products/${p.id}`}
                          className="truncate hover:underline block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {p.brand || "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {cost > 0 ? formatARS(cost) : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">
                          {p.markupRegular.toFixed(2)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {(p.ivaRate * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {cost > 0 ? formatARS(pvRegular) : "-"}
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {pvOferta ? formatARS(pvOferta) : "-"}
                      </TableCell>
                      <TableCell
                        className={`text-right ${
                          margen > 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {cost > 0 ? formatARS(margen) : "-"}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} productos con precio
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => updateParams({ page: String(page - 1) })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {(() => {
            const pages: (number | string)[] = [];
            const showPages = 5;
            let start = Math.max(1, page - Math.floor(showPages / 2));
            const end = Math.min(totalPages, start + showPages - 1);
            if (end - start < showPages - 1) {
              start = Math.max(1, end - showPages + 1);
            }
            if (start > 1) {
              pages.push(1);
              if (start > 2) pages.push("...");
            }
            for (let i = start; i <= end; i++) {
              pages.push(i);
            }
            if (end < totalPages) {
              if (end < totalPages - 1) pages.push("...");
              pages.push(totalPages);
            }
            return pages.map((p, idx) =>
              typeof p === "number" ? (
                <Button
                  key={idx}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="w-9"
                  onClick={() => updateParams({ page: String(p) })}
                >
                  {p}
                </Button>
              ) : (
                <span key={idx} className="px-2 text-muted-foreground">
                  {p}
                </span>
              )
            );
          })()}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
