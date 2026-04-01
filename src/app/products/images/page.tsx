"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  XCircle,
  ImageOff,
  Loader2,
  Search,
  Play,
  ChevronLeft,
  ChevronRight,
  Eye,
  Wand2,
  Link2,
  Tag,
  RotateCcw,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AuditCounts {
  listo: number;
  ok: number;
  needs_conversion: number;
  bad_quality: number;
  no_image: number;
  unchecked: number;
}

interface AuditStatus {
  total: number;
  audited: number;
  counts: AuditCounts;
}

interface AuditData {
  width: number;
  height: number;
  format: string;
  isWebP: boolean;
  hasWhiteBg: boolean;
  checkedAt: string;
  error?: string;
}

interface ProductRow {
  id: number;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  galleryImages: string | null;
  woocommerceId: number | null;
  imageAuditStatus: string | null;
  imageAuditData: string | null;
  wooMainImageAttachmentId: number | null;
  wooGalleryAttachmentIds: string | null;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  listo: "Listo",
  ok: "OK",
  needs_conversion: "Convertible",
  bad_quality: "Mala calidad",
  no_image: "Sin imagen",
};

const STATUS_COLOR: Record<string, string> = {
  listo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ok: "bg-green-500/15 text-green-700 dark:text-green-400",
  needs_conversion: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  bad_quality: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  no_image: "bg-muted text-muted-foreground",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  listo: <CheckCircle2 className="h-3.5 w-3.5" />,
  ok: <CheckCircle2 className="h-3.5 w-3.5 opacity-50" />,
  needs_conversion: <RefreshCw className="h-3.5 w-3.5" />,
  bad_quality: <AlertTriangle className="h-3.5 w-3.5" />,
  no_image: <ImageOff className="h-3.5 w-3.5" />,
};

function StatusBadge({ status }: { status: string | null }) {
  const s = status ?? "unchecked";
  if (s === "unchecked") {
    return <span className="text-xs text-muted-foreground">Sin auditar</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLOR[s] ?? ""}`}>
      {STATUS_ICON[s]}
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

// ── Dialog: new URL ────────────────────────────────────────────────────────────

function ReplaceUrlDialog({
  open,
  onClose,
  product,
  target,
  galleryIndex,
  onProcessed,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRow;
  target: "main" | "gallery";
  galleryIndex: number;
  onProcessed: (productId: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<{ audit: AuditData } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [processing, setProcessing] = useState(false);

  const analyze = async () => {
    if (!url.trim()) return;
    setAnalyzing(true);
    setPreview(null);
    try {
      const res = await fetch("/api/images/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          target,
          galleryIndex,
          newUrl: url.trim(),
          analyzeOnly: true,
        }),
      });
      const data = await res.json() as { audit: AuditData };
      setPreview(data);
    } catch {
      toast.error("Error al analizar la imagen");
    } finally {
      setAnalyzing(false);
    }
  };

  const process = async (forceConvert = false) => {
    setProcessing(true);
    try {
      const res = await fetch("/api/images/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          target,
          galleryIndex,
          newUrl: url.trim(),
          forceConvert,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        toast.success("Imagen procesada y subida a WooCommerce");
        onProcessed(product.id);
        onClose();
      } else {
        toast.error(data.error ?? "Error al procesar");
      }
    } catch {
      toast.error("Error al procesar la imagen");
    } finally {
      setProcessing(false);
    }
  };

  const audit = preview?.audit;
  const isOk = audit && (audit.isWebP || true) && audit.width >= 600 && audit.height >= 600 && audit.hasWhiteBg;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target === "main" ? "Reemplazar imagen principal" : `Reemplazar imagen de galería #${galleryIndex + 1}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            <span className="font-medium">{product.name}</span>
          </p>

          <div className="flex gap-2">
            <Input
              placeholder="https://..."
              value={url}
              onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
              onKeyDown={(e) => e.key === "Enter" && analyze()}
            />
            <Button variant="outline" onClick={analyze} disabled={analyzing || !url.trim()}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>

          {url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt="Preview"
              className="h-32 w-full object-contain border rounded-md bg-muted/30"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}

          {audit && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <p className="font-medium">Análisis</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <span>Dimensiones</span>
                <span className={audit.width >= 600 && audit.height >= 600 ? "text-green-600" : "text-orange-600"}>
                  {audit.width}×{audit.height}px {audit.width < 600 || audit.height < 600 ? "⚠ menor a 600px" : "✓"}
                </span>
                <span>Formato</span>
                <span className={audit.isWebP ? "text-green-600" : "text-orange-600"}>
                  {audit.format.toUpperCase()} {audit.isWebP ? "✓" : "(se convertirá a WebP)"}
                </span>
                <span>Fondo</span>
                <span className={audit.hasWhiteBg ? "text-green-600" : "text-orange-600"}>
                  {audit.hasWhiteBg ? "✓ Blanco / transparente" : "⚠ No es blanco/transparente"}
                </span>
              </div>
              {audit.error && (
                <p className="text-red-500 text-xs mt-1">{audit.error}</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={processing}>Cancelar</Button>
          {audit && !isOk && (
            <Button
              variant="secondary"
              onClick={() => process(true)}
              disabled={processing || !url.trim()}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Wand2 className="h-4 w-4 mr-1" />}
              Subir igual (forzar)
            </Button>
          )}
          <Button
            onClick={() => process(false)}
            disabled={processing || !url.trim() || !audit}
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            {isOk ? "Procesar y subir" : "Procesar y subir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Gallery dialog ─────────────────────────────────────────────────────────────

function GalleryDialog({
  open,
  onClose,
  product,
  onProcessed,
}: {
  open: boolean;
  onClose: () => void;
  product: ProductRow;
  onProcessed: (productId: number) => void;
}) {
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null);
  const [processing, setProcessing] = useState<number | null>(null);

  const mainUrls = (product.imageUrl ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  const galleryUrls: string[] = product.galleryImages ? JSON.parse(product.galleryImages) : [];
  const allUrls = [...mainUrls, ...galleryUrls];

  const processExisting = async (idx: number, isMain: boolean) => {
    setProcessing(idx);
    try {
      const res = await fetch("/api/images/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          target: isMain ? "main" : "gallery",
          galleryIndex: isMain ? 0 : idx - mainUrls.length,
          forceConvert: true,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        toast.success("Imagen convertida y subida");
        onProcessed(product.id);
      } else {
        toast.error(data.error ?? "Error");
      }
    } catch {
      toast.error("Error al procesar");
    } finally {
      setProcessing(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Imágenes — {product.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto py-2">
            {allUrls.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Sin imágenes cargadas</p>
            )}
            {allUrls.map((url, idx) => {
              const isMain = idx < mainUrls.length;
              const label = isMain ? "Principal" : `Galería #${idx - mainUrls.length + 1}`;
              return (
                <div key={idx} className="flex items-center gap-3 p-2 rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={label}
                    className="h-16 w-16 object-contain rounded border bg-muted/30 shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{url}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => processExisting(idx, isMain)}
                      disabled={processing === idx}
                    >
                      {processing === idx
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Wand2 className="h-3.5 w-3.5" />}
                      WebP
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReplaceIdx(idx)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Nueva URL
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {replaceIdx !== null && (
        <ReplaceUrlDialog
          open
          onClose={() => setReplaceIdx(null)}
          product={product}
          target={replaceIdx < mainUrls.length ? "main" : "gallery"}
          galleryIndex={replaceIdx < mainUrls.length ? 0 : replaceIdx - mainUrls.length}
          onProcessed={(id) => { onProcessed(id); setReplaceIdx(null); }}
        />
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

const STATUS_TABS = ["all", "bad_quality", "needs_conversion", "no_image", "ok", "listo", "unchecked"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const TAB_LABEL: Record<StatusTab, string> = {
  all: "Todos",
  bad_quality: "Mala calidad",
  needs_conversion: "Convertibles",
  no_image: "Sin imagen",
  ok: "OK",
  listo: "Listo",
  unchecked: "Sin auditar",
};

export default function ImagesPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <p className="text-sm">Esta función no está disponible en la demo.</p>
      </div>
    );
  }
  return <ImagesPageInner />;
}

function ImagesPageInner() {
  const [auditStatus, setAuditStatus] = useState<AuditStatus | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditProgress, setAuditProgress] = useState<{ offset: number; total: number } | null>(null);
  const auditRef = useRef(false);

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loadingList, setLoadingList] = useState(false);

  const [bulkConverting, setBulkConverting] = useState(false);
  const [bulkSeo, setBulkSeo] = useState(false);
  const [bulkRenaming, setBulkRenaming] = useState(false);
  const [bulkRenameProgress, setBulkRenameProgress] = useState<{ done: number; total: number } | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [seoProcessingId, setSeoProcessingId] = useState<number | null>(null);
  const [reoptimizeId, setReoptimizeId] = useState<number | null>(null);

  const [replaceDialog, setReplaceDialog] = useState<{ product: ProductRow } | null>(null);
  const [galleryDialog, setGalleryDialog] = useState<ProductRow | null>(null);

  // ── Load audit status ──────────────────────────────────────────────────────
  const loadAuditStatus = useCallback(async () => {
    const res = await fetch("/api/images/audit/chunk");
    if (res.ok) setAuditStatus(await res.json() as AuditStatus);
  }, []);

  useEffect(() => { loadAuditStatus(); }, [loadAuditStatus]);

  // ── Load product list ──────────────────────────────────────────────────────
  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams({
        status: statusTab,
        search,
        page: String(page),
        limit: "50",
      });
      const res = await fetch(`/api/images/list?${params}`);
      if (res.ok) {
        const data = await res.json() as { rows: ProductRow[]; total: number; pages: number };
        setRows(data.rows);
        setTotalRows(data.total);
        setTotalPages(data.pages);
      }
    } finally {
      setLoadingList(false);
    }
  }, [statusTab, search, page]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { setPage(1); }, [statusTab, search]);

  // ── Run audit ─────────────────────────────────────────────────────────────
  const runAudit = async (force = false) => {
    setAuditing(true);
    auditRef.current = true;
    const chunkSize = 50;
    let offset = 0;
    let total = 1;

    try {
      while (auditRef.current && offset < total) {
        const res = await fetch("/api/images/audit/chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, limit: chunkSize, force }),
        });
        if (!res.ok) break;
        const data = await res.json() as {
          nextOffset: number;
          total: number;
          audited: number;
          counts: AuditCounts;
        };
        total = data.total;
        offset = data.nextOffset;
        setAuditProgress({ offset: Math.min(offset, total), total });
        setAuditStatus({ total: data.total, audited: data.audited, counts: data.counts });
      }
    } finally {
      auditRef.current = false;
      setAuditing(false);
      setAuditProgress(null);
      loadList();
    }
  };

  const stopAudit = () => {
    auditRef.current = false;
  };

  // ── Process single product (convert to WebP) ───────────────────────────────
  const processProduct = async (product: ProductRow, forceConvert = false) => {
    if (!product.woocommerceId) {
      toast.error("El producto no tiene ID de WooCommerce");
      return;
    }
    setProcessingId(product.id);
    try {
      const res = await fetch("/api/images/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: product.id,
          target: "main",
          forceConvert,
        }),
      });
      const data = await res.json() as { success?: boolean; error?: string; audit?: AuditData };
      if (data.success) {
        toast.success("Imagen convertida a WebP y subida a WooCommerce");
        loadList();
        loadAuditStatus();
      } else if (data.error === "bad_quality") {
        toast.error("Imagen con fondo malo o tamaño chico. Usá 'Forzar' o pegá una nueva URL.");
      } else {
        toast.error(data.error ?? "Error al procesar");
      }
    } catch {
      toast.error("Error al procesar la imagen");
    } finally {
      setProcessingId(null);
    }
  };

  // ── Update SEO (title + alt) for a single product ─────────────────────────
  const updateSeo = async (product: ProductRow) => {
    if (!product.woocommerceId) { toast.error("El producto no tiene ID de WooCommerce"); return; }
    setSeoProcessingId(product.id);
    try {
      const res = await fetch("/api/images/update-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json() as { updated: number; errors: string[]; title?: string; alt?: string };
      if (data.updated > 0) {
        toast.success(`SEO actualizado — Title: "${data.title}" / Alt: "${data.alt}"`);
      } else {
        toast.error(data.errors?.[0] ?? "No se pudo actualizar el SEO");
      }
    } catch {
      toast.error("Error al actualizar SEO");
    } finally {
      setSeoProcessingId(null);
    }
  };

  // ── Re-upload ok image with correct slug filename ──────────────────────────
  const reoptimize = async (product: ProductRow) => {
    if (!product.woocommerceId) { toast.error("El producto no tiene ID de WooCommerce"); return; }
    setReoptimizeId(product.id);
    try {
      const res = await fetch("/api/images/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, target: "main", forceConvert: true }),
      });
      const data = await res.json() as { success?: boolean; newUrl?: string; error?: string };
      if (data.success) {
        toast.success("Imagen re-subida con filename SEO correcto");
        await loadList();
      } else {
        toast.error(data.error ?? "Error al reoptimizar");
      }
    } catch {
      toast.error("Error al reoptimizar");
    } finally {
      setReoptimizeId(null);
    }
  };

  // ── Bulk SEO update for all "ok" products ──────────────────────────────────
  const bulkUpdateSeo = async () => {
    setBulkSeo(true);
    try {
      const res = await fetch("/api/images/update-seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulk: true }),
      });
      const data = await res.json() as { updated: number; errors: string[]; total: number };
      if (data.errors.length > 0) {
        toast.warning(`SEO: ${data.updated} attachments actualizados, ${data.errors.length} errores`);
      } else {
        toast.success(`SEO optimizado en ${data.updated} attachments de ${data.total} productos`);
      }
    } catch {
      toast.error("Error al actualizar SEO en bulk");
    } finally {
      setBulkSeo(false);
    }
  };

  // ── Bulk convert needs_conversion ──────────────────────────────────────────
  const bulkConvert = async () => {
    setBulkConverting(true);
    const res = await fetch("/api/images/list?status=needs_conversion&limit=500");
    if (!res.ok) { setBulkConverting(false); return; }
    const data = await res.json() as { rows: ProductRow[] };
    const convertible = data.rows.filter((r) => r.woocommerceId);

    let done = 0;
    for (const product of convertible) {
      try {
        await fetch("/api/images/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, target: "main" }),
        });
        done++;
      } catch {
        // continue
      }
    }

    toast.success(`${done} imágenes convertidas a WebP`);
    loadList();
    loadAuditStatus();
    setBulkConverting(false);
  };

  // ── Bulk rename all "ok" products (batches of 5, 2s pause between batches) ──
  const bulkRename = async () => {
    setBulkRenaming(true);
    setBulkRenameProgress(null);
    const res = await fetch("/api/images/list?status=ok&limit=2000");
    if (!res.ok) { setBulkRenaming(false); return; }
    const data = await res.json() as { rows: ProductRow[] };
    const toRename = data.rows.filter((r) => r.woocommerceId);

    let done = 0;
    const total = toRename.length;
    setBulkRenameProgress({ done: 0, total });

    const BATCH_SIZE = 5;
    const PAUSE_MS = 2000;

    for (let i = 0; i < toRename.length; i += BATCH_SIZE) {
      const batch = toRename.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (product) => {
        try {
          await fetch("/api/images/process", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ productId: product.id, target: "main", forceConvert: true }),
          });
        } catch { /* continue */ }
        done++;
        setBulkRenameProgress({ done, total });
      }));
      // Pause between batches to avoid overwhelming Railway + WP
      if (i + BATCH_SIZE < toRename.length) {
        await new Promise((r) => setTimeout(r, PAUSE_MS));
      }
    }

    toast.success(`${done} imágenes renombradas y marcadas como Listo`);
    setBulkRenaming(false);
    setBulkRenameProgress(null);
    loadList();
    loadAuditStatus();
  };

  const onProductProcessed = (productId: number) => {
    setRows((prev) => prev.filter((r) => r.id !== productId));
    loadAuditStatus();
  };

  const { counts } = auditStatus ?? { counts: { listo: 0, ok: 0, needs_conversion: 0, bad_quality: 0, no_image: 0, unchecked: 0 } };
  const auditedCount = (counts.listo + counts.ok + counts.needs_conversion + counts.bad_quality + counts.no_image);
  const auditPct = auditStatus ? Math.round((auditedCount / auditStatus.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gestión de Imágenes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Audit, conversión a WebP y reemplazo de imágenes de productos
          </p>
        </div>
        <div className="flex gap-2">
          {auditStatus && counts.ok > 0 && (
            <>
              <Button
                variant="outline"
                onClick={bulkRename}
                disabled={bulkRenaming || bulkSeo || auditing}
              >
                {bulkRenaming
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <RotateCcw className="h-4 w-4 mr-2" />}
                {bulkRenaming && bulkRenameProgress
                  ? `Renombrando... ${bulkRenameProgress.done}/${bulkRenameProgress.total}`
                  : `Renombrar todos (${counts.ok} ok)`}
              </Button>
              <Button
                variant="outline"
                onClick={bulkUpdateSeo}
                disabled={bulkSeo || bulkRenaming || auditing}
              >
                {bulkSeo
                  ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  : <Tag className="h-4 w-4 mr-2" />}
                Optimizar SEO ({counts.ok} ok)
              </Button>
            </>
          )}
          {auditStatus && counts.needs_conversion > 0 && (
            <Button
              variant="secondary"
              onClick={bulkConvert}
              disabled={bulkConverting || auditing}
            >
              {bulkConverting
                ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
                : <Wand2 className="h-4 w-4 mr-2" />}
              Convertir todos los convertibles ({counts.needs_conversion})
            </Button>
          )}
          {auditing ? (
            <Button variant="destructive" onClick={stopAudit}>
              <XCircle className="h-4 w-4 mr-2" /> Detener
            </Button>
          ) : (
            <>
              {auditStatus && auditedCount < auditStatus.total && (
                <Button onClick={() => runAudit(false)}>
                  <Play className="h-4 w-4 mr-2" /> Continuar audit
                </Button>
              )}
              <Button
                variant={auditedCount === 0 ? "default" : "outline"}
                onClick={() => runAudit(auditedCount === 0 ? false : true)}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {auditedCount === 0 ? "Iniciar audit" : "Re-auditar todo"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats cards */}
      {auditStatus && (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          {[
            { key: "listo", label: "Listo", color: "text-emerald-600", icon: <CheckCircle2 className="h-4 w-4" /> },
            { key: "ok", label: "OK (pendiente renombrar)", color: "text-green-600", icon: <CheckCircle2 className="h-4 w-4 opacity-50" /> },
            { key: "needs_conversion", label: "Convertibles", color: "text-blue-600", icon: <RefreshCw className="h-4 w-4" /> },
            { key: "bad_quality", label: "Mala calidad", color: "text-orange-600", icon: <AlertTriangle className="h-4 w-4" /> },
            { key: "no_image", label: "Sin imagen", color: "text-muted-foreground", icon: <ImageOff className="h-4 w-4" /> },
            { key: "unchecked", label: "Sin auditar", color: "text-muted-foreground", icon: <Search className="h-4 w-4" /> },
          ].map(({ key, label, color, icon }) => (
            <Card
              key={key}
              className={`cursor-pointer transition-all ${statusTab === key ? "ring-2 ring-primary" : "hover:border-primary/50"}`}
              onClick={() => setStatusTab(key as StatusTab)}
            >
              <CardContent className="pt-4 pb-3">
                <div className={`flex items-center gap-1.5 ${color} mb-1`}>{icon}<span className="text-xs font-medium">{label}</span></div>
                <p className="text-2xl font-bold">{counts[key as keyof AuditCounts] ?? 0}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Audit progress */}
      {(auditing || (auditStatus && auditedCount < (auditStatus.total ?? 0))) && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm">
                {auditing && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                <span className="font-medium">
                  {auditing ? "Auditando..." : "Audit incompleto"}
                </span>
                <span className="text-muted-foreground">
                  {auditProgress
                    ? `${auditProgress.offset.toLocaleString()} / ${auditProgress.total.toLocaleString()}`
                    : `${auditedCount.toLocaleString()} / ${auditStatus?.total.toLocaleString()} auditados`}
                </span>
              </div>
              <span className="text-sm font-semibold">{auditPct}%</span>
            </div>
            <Progress value={auditPct} className="h-2" />
          </CardContent>
        </Card>
      )}

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setStatusTab(tab)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                statusTab === tab
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABEL[tab]}
              {tab !== "all" && auditStatus && (
                <span className="ml-1.5 opacity-70">
                  {tab === "unchecked"
                    ? counts.unchecked
                    : counts[tab as keyof AuditCounts] ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground text-xs">
                  <th className="text-left px-4 py-3 font-medium w-16">Imagen</th>
                  <th className="text-left px-4 py-3 font-medium">Producto</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Dims</th>
                  <th className="text-left px-4 py-3 font-medium">Formato</th>
                  <th className="text-left px-4 py-3 font-medium">Fondo</th>
                  <th className="text-right px-4 py-3 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loadingList && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                    </td>
                  </tr>
                )}
                {!loadingList && rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-muted-foreground text-sm">
                      No hay productos en este filtro
                    </td>
                  </tr>
                )}
                {!loadingList && rows.map((row) => {
                  const auditData: AuditData | null = row.imageAuditData
                    ? JSON.parse(row.imageAuditData)
                    : null;
                  const mainUrl = (row.imageUrl ?? "").split(",")[0].trim();
                  const isProcessing = processingId === row.id;
                  const isSeoProcessing = seoProcessingId === row.id;
                  const isReoptimizing = reoptimizeId === row.id;
                  const hasWoo = !!row.woocommerceId;

                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      {/* Thumbnail */}
                      <td className="px-4 py-2.5">
                        {mainUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={mainUrl}
                            alt=""
                            className="h-12 w-12 object-contain rounded border bg-white dark:bg-zinc-900"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="h-12 w-12 rounded border bg-muted flex items-center justify-center">
                            <ImageOff className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </td>

                      {/* Name */}
                      <td className="px-4 py-2.5">
                        <a
                          href={`/products/${row.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:underline line-clamp-2 text-sm"
                        >
                          {row.name}
                        </a>
                        {row.sku && (
                          <p className="text-xs text-muted-foreground">{row.sku}</p>
                        )}
                        {!hasWoo && (
                          <p className="text-[10px] text-orange-600 mt-0.5">Sin WC ID — no se puede subir</p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-2.5">
                        <StatusBadge status={row.imageAuditStatus} />
                      </td>

                      {/* Dims */}
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {auditData?.width && auditData?.height
                          ? <span className={auditData.width < 600 || auditData.height < 600 ? "text-orange-600" : ""}>
                              {auditData.width}×{auditData.height}
                            </span>
                          : "—"}
                      </td>

                      {/* Format */}
                      <td className="px-4 py-2.5 text-xs">
                        {auditData
                          ? <span className={auditData.isWebP ? "text-green-600" : "text-orange-600"}>
                              {auditData.format.toUpperCase()}
                            </span>
                          : "—"}
                      </td>

                      {/* Background */}
                      <td className="px-4 py-2.5 text-xs">
                        {auditData
                          ? <span className={auditData.hasWhiteBg ? "text-green-600" : "text-orange-600"}>
                              {auditData.hasWhiteBg ? "Blanco ✓" : "No blanco"}
                            </span>
                          : "—"}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {/* Gallery button */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setGalleryDialog(row)}
                          >
                            Galería
                          </Button>

                          {row.imageAuditStatus === "listo" && (
                            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Listo
                            </span>
                          )}

                          {row.imageAuditStatus === "ok" && hasWoo && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => updateSeo(row)}
                                disabled={isSeoProcessing || isReoptimizing}
                                title="Actualizar título y alt del attachment existente"
                              >
                                {isSeoProcessing
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Tag className="h-3.5 w-3.5 mr-1" />}
                                SEO
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => reoptimize(row)}
                                disabled={isReoptimizing || isSeoProcessing}
                                title="Re-subir imagen con filename slug correcto"
                              >
                                {isReoptimizing
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <RotateCcw className="h-3.5 w-3.5 mr-1" />}
                                Renombrar
                              </Button>
                            </>
                          )}
                          {row.imageAuditStatus === "needs_conversion" && hasWoo && (
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => processProduct(row)}
                              disabled={isProcessing}
                            >
                              {isProcessing
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                              Convertir WebP
                            </Button>
                          )}

                          {row.imageAuditStatus === "bad_quality" && hasWoo && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 px-2 text-xs"
                                onClick={() => processProduct(row, true)}
                                disabled={isProcessing}
                              >
                                {isProcessing
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Wand2 className="h-3.5 w-3.5 mr-1" />}
                                Forzar WebP
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => setReplaceDialog({ product: row })}
                              >
                                <Link2 className="h-3.5 w-3.5 mr-1" /> Nueva URL
                              </Button>
                            </>
                          )}

                          {(row.imageAuditStatus === "no_image" || !row.imageAuditStatus) && hasWoo && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => setReplaceDialog({ product: row })}
                            >
                              <Link2 className="h-3.5 w-3.5 mr-1" /> Agregar imagen
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm">
              <p className="text-muted-foreground">
                {((page - 1) * 50 + 1).toLocaleString()}–{Math.min(page * 50, totalRows).toLocaleString()} de {totalRows.toLocaleString()}
              </p>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 py-1 text-xs">
                  {page} / {totalPages}
                </span>
                <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Replace URL dialog */}
      {replaceDialog && (
        <ReplaceUrlDialog
          open
          onClose={() => setReplaceDialog(null)}
          product={replaceDialog.product}
          target="main"
          galleryIndex={0}
          onProcessed={(id) => { onProductProcessed(id); setReplaceDialog(null); }}
        />
      )}

      {/* Gallery dialog */}
      {galleryDialog && (
        <GalleryDialog
          open
          onClose={() => setGalleryDialog(null)}
          product={galleryDialog}
          onProcessed={(id) => { onProductProcessed(id); setGalleryDialog(null); }}
        />
      )}
    </div>
  );
}
