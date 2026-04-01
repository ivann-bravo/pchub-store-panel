"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { Sparkles, Pause, Square, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CONCURRENCY = 10; // parallel Gemini requests per batch
const BATCH_DELAY_MS = 500; // ms between batches
const LS_LAST_EXPORT_PRODUCTS = "desc-last-export-products";
const LS_LAST_EXPORT_COMBOS = "desc-last-export-combos";

interface DescStatus {
  products: { total: number; withDesc: number };
  combos: { total: number; withDesc: number };
}

type BatchType = "products" | "combos";
type BatchState = "idle" | "running" | "paused";

function ProgressBar({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{value.toLocaleString("es-AR")} / {total.toLocaleString("es-AR")}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300 rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatExportDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.click();
}

export default function DescriptionsPage() {
  const [status, setStatus] = useState<DescStatus | null>(null);
  const [activeTab, setActiveTab] = useState<BatchType>("products");

  // Batch state for products
  const [productBatch, setProductBatch] = useState<BatchState>("idle");
  const [productProgress, setProductProgress] = useState(0);
  const [productTotal, setProductTotal] = useState(0);
  const [productCurrent, setProductCurrent] = useState<string>("");
  const [productErrors, setProductErrors] = useState<string[]>([]);
  const productPausedRef = useRef(false);
  const productStopRef = useRef(false);

  // Batch state for combos
  const [comboBatch, setComboBatch] = useState<BatchState>("idle");
  const [comboProgress, setComboProgress] = useState(0);
  const [comboTotal, setComboTotal] = useState(0);
  const [comboCurrent, setComboCurrent] = useState<string>("");
  const [comboErrors, setComboErrors] = useState<string[]>([]);
  const comboPausedRef = useRef(false);
  const comboStopRef = useRef(false);

  // Last export timestamps (from localStorage)
  const [lastProductsExport, setLastProductsExport] = useState<string | null>(null);
  const [lastCombosExport, setLastCombosExport] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/descriptions/status");
      if (res.ok) setStatus(await res.json() as DescStatus);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    setLastProductsExport(localStorage.getItem(LS_LAST_EXPORT_PRODUCTS));
    setLastCombosExport(localStorage.getItem(LS_LAST_EXPORT_COMBOS));
  }, [fetchStatus]);

  const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

  // Estimate time remaining based on CONCURRENCY and ~9s avg response per batch
  const estimateTime = (pending: number) => {
    const seconds = Math.ceil(pending / CONCURRENCY) * 9;
    const hours = seconds / 3600;
    if (hours < 1) return `${Math.round(seconds / 60)} min`;
    return `${hours.toFixed(1)} hs`;
  };

  const startBatch = async (type: BatchType) => {
    const pausedRef = type === "products" ? productPausedRef : comboPausedRef;
    const stopRef = type === "products" ? productStopRef : comboStopRef;
    const setBatchState = type === "products" ? setProductBatch : setComboBatch;
    const setProgress = type === "products" ? setProductProgress : setComboProgress;
    const setTotal = type === "products" ? setProductTotal : setComboTotal;
    const setCurrent = type === "products" ? setProductCurrent : setComboCurrent;
    const setErrors = type === "products" ? setProductErrors : setComboErrors;

    pausedRef.current = false;
    stopRef.current = false;
    setErrors([]);
    setBatchState("running");

    // Fetch pending IDs
    let ids: number[] = [];
    try {
      const res = await fetch(`/api/descriptions/pending-ids?type=${type}`);
      const data = await res.json() as { ids: number[] };
      ids = data.ids;
    } catch {
      toast.error("Error al obtener IDs pendientes");
      setBatchState("idle");
      return;
    }

    setTotal(ids.length);
    setProgress(0);

    if (ids.length === 0) {
      toast.success("¡Todas las descripciones ya están generadas!");
      setBatchState("idle");
      return;
    }

    const apiPath = type === "products"
      ? (id: number) => `/api/products/${id}/generate-description`
      : (id: number) => `/api/combos/${id}/generate-description`;

    let done = 0;

    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      if (stopRef.current) break;

      // Wait while paused
      while (pausedRef.current) {
        await delay(500);
        if (stopRef.current) break;
      }
      if (stopRef.current) break;

      const chunk = ids.slice(i, i + CONCURRENCY);

      await Promise.allSettled(
        chunk.map(async (id) => {
          try {
            const res = await fetch(apiPath(id), { method: "POST" });
            if (!res.ok) {
              const err = await res.json() as { error?: string };
              setErrors((prev) => [...prev, `ID ${id}: ${err.error ?? "Error desconocido"}`]);
            } else {
              const data = await res.json() as { name?: string };
              if (data.name) setCurrent(data.name);
            }
          } catch {
            setErrors((prev) => [...prev, `ID ${id}: Error de red`]);
          }
          done++;
          setProgress(done);
        })
      );

      await fetchStatus();

      if (i + CONCURRENCY < ids.length && !stopRef.current) {
        await delay(BATCH_DELAY_MS);
      }
    }

    setBatchState("idle");
    setCurrent("");
    fetchStatus();
    toast.success(`Batch completado: ${done} descripción${done !== 1 ? "es" : ""} procesadas`);
  };

  const pauseBatch = (type: BatchType) => {
    if (type === "products") {
      productPausedRef.current = true;
      setProductBatch("paused");
    } else {
      comboPausedRef.current = true;
      setComboBatch("paused");
    }
  };

  const resumeBatch = (type: BatchType) => {
    if (type === "products") {
      productPausedRef.current = false;
      setProductBatch("running");
    } else {
      comboPausedRef.current = false;
      setComboBatch("running");
    }
  };

  const stopBatch = (type: BatchType) => {
    if (type === "products") {
      productStopRef.current = true;
      productPausedRef.current = false;
      setProductBatch("idle");
    } else {
      comboStopRef.current = true;
      comboPausedRef.current = false;
      setComboBatch("idle");
    }
  };

  const handleExport = (type: "products" | "combos", delta: boolean) => {
    const lsKey = type === "products" ? LS_LAST_EXPORT_PRODUCTS : LS_LAST_EXPORT_COMBOS;
    const setLast = type === "products" ? setLastProductsExport : setLastCombosExport;
    const lastExport = type === "products" ? lastProductsExport : lastCombosExport;
    const base = type === "products"
      ? "/api/descriptions/export-products"
      : "/api/descriptions/export-combos";

    const url = delta && lastExport
      ? `${base}?since=${encodeURIComponent(lastExport)}`
      : base;

    triggerDownload(url);

    const now = new Date().toISOString();
    localStorage.setItem(lsKey, now);
    setLast(now);
  };

  const productsPending = (status?.products.total ?? 0) - (status?.products.withDesc ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Descripciones"
        breadcrumbs={[{ label: "Catálogo" }, { label: "Descripciones" }]}
        description="Generá descripciones HTML para WooCommerce usando Gemini AI."
      />

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Productos</CardTitle>
          </CardHeader>
          <CardContent>
            {status ? (
              <ProgressBar value={status.products.withDesc} total={status.products.total} />
            ) : (
              <div className="h-8 bg-muted animate-pulse rounded" />
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Combos</CardTitle>
          </CardHeader>
          <CardContent>
            {status ? (
              <ProgressBar value={status.combos.withDesc} total={status.combos.total} />
            ) : (
              <div className="h-8 bg-muted animate-pulse rounded" />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rate limit notice */}
      <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-300">Gemini 2.5 Flash — tier pagado</p>
              <p className="text-amber-700 dark:text-amber-400 text-xs">
                <strong>1K RPM · 10K RPD.</strong> Batch: {CONCURRENCY} requests en paralelo, {BATCH_DELAY_MS}ms entre grupos.
                {productsPending > 0 && (
                  <> Para los <strong>{productsPending.toLocaleString("es-AR")}</strong> productos pendientes: ~{estimateTime(productsPending)} (limitado a 10K/día).</>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border rounded-md p-0.5 w-fit">
        <button
          onClick={() => setActiveTab("products")}
          className={`px-4 py-1.5 text-sm rounded font-medium transition-colors ${activeTab === "products" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Productos
        </button>
        <button
          onClick={() => setActiveTab("combos")}
          className={`px-4 py-1.5 text-sm rounded font-medium transition-colors ${activeTab === "combos" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Combos
        </button>
      </div>

      {/* Products batch panel */}
      {activeTab === "products" && (
        <Card>
          <CardHeader>
            <CardTitle>Generación masiva — Productos</CardTitle>
            <CardDescription>
              {CONCURRENCY} requests en paralelo. El browser debe quedar abierto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {productBatch === "idle" && (
                <Button onClick={() => startBatch("products")} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Iniciar generación masiva
                </Button>
              )}
              {productBatch === "running" && (
                <Button variant="outline" onClick={() => pauseBatch("products")} className="gap-2">
                  <Pause className="h-4 w-4" />
                  Pausar
                </Button>
              )}
              {productBatch === "paused" && (
                <Button onClick={() => resumeBatch("products")} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Reanudar
                </Button>
              )}
              {productBatch !== "idle" && (
                <Button variant="destructive" onClick={() => stopBatch("products")} className="gap-2">
                  <Square className="h-4 w-4" />
                  Detener
                </Button>
              )}
              <Button variant="outline" onClick={() => handleExport("products", false)} className="gap-2">
                <Download className="h-4 w-4" />
                Exportar todo
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("products", true)}
                disabled={!lastProductsExport}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {lastProductsExport
                  ? `Novedades desde ${formatExportDate(lastProductsExport)}`
                  : "Novedades (sin exportación previa)"}
              </Button>
            </div>

            {productBatch !== "idle" && (
              <div className="space-y-2">
                <ProgressBar value={productProgress} total={productTotal} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {productBatch === "running" ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                      Generando...
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pausado</Badge>
                  )}
                  {productCurrent && <span className="truncate">Último: &ldquo;{productCurrent}&rdquo;</span>}
                  {productTotal > productProgress && (
                    <span className="shrink-0">
                      ≈ {estimateTime(productTotal - productProgress)} restantes
                    </span>
                  )}
                </div>
              </div>
            )}

            {productErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-destructive mb-1">Errores ({productErrors.length}):</p>
                {productErrors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Combos batch panel */}
      {activeTab === "combos" && (
        <Card>
          <CardHeader>
            <CardTitle>Generación masiva — Combos</CardTitle>
            <CardDescription>
              {CONCURRENCY} requests en paralelo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {comboBatch === "idle" && (
                <Button onClick={() => startBatch("combos")} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Iniciar generación masiva
                </Button>
              )}
              {comboBatch === "running" && (
                <Button variant="outline" onClick={() => pauseBatch("combos")} className="gap-2">
                  <Pause className="h-4 w-4" />
                  Pausar
                </Button>
              )}
              {comboBatch === "paused" && (
                <Button onClick={() => resumeBatch("combos")} className="gap-2">
                  <Sparkles className="h-4 w-4" />
                  Reanudar
                </Button>
              )}
              {comboBatch !== "idle" && (
                <Button variant="destructive" onClick={() => stopBatch("combos")} className="gap-2">
                  <Square className="h-4 w-4" />
                  Detener
                </Button>
              )}
              <Button variant="outline" onClick={() => handleExport("combos", false)} className="gap-2">
                <Download className="h-4 w-4" />
                Exportar todo
              </Button>
              <Button
                variant="outline"
                onClick={() => handleExport("combos", true)}
                disabled={!lastCombosExport}
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {lastCombosExport
                  ? `Novedades desde ${formatExportDate(lastCombosExport)}`
                  : "Novedades (sin exportación previa)"}
              </Button>
            </div>

            {comboBatch !== "idle" && (
              <div className="space-y-2">
                <ProgressBar value={comboProgress} total={comboTotal} />
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {comboBatch === "running" ? (
                    <Badge variant="secondary" className="gap-1 text-xs">
                      <Sparkles className="h-2.5 w-2.5 animate-pulse" />
                      Generando...
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Pausado</Badge>
                  )}
                  {comboCurrent && <span className="truncate">Último: &ldquo;{comboCurrent}&rdquo;</span>}
                  {comboTotal > comboProgress && (
                    <span className="shrink-0">
                      ≈ {estimateTime(comboTotal - comboProgress)} restantes
                    </span>
                  )}
                </div>
              </div>
            )}

            {comboErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-destructive mb-1">Errores ({comboErrors.length}):</p>
                {comboErrors.map((e, i) => (
                  <p key={i} className="text-xs text-muted-foreground">{e}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
