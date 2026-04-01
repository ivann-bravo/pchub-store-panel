"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Save, ExternalLink, TrendingUp, Calculator,
  ArrowRight, Package, Sparkles, Copy, RefreshCw, Lock, Unlock, ShoppingCart, Download, ImageUp, EyeOff, Eye,
} from "lucide-react";
import { WooCategoryPicker } from "@/components/woo-category-picker";
import { formatARS, formatArgNumber, formatClientPrice } from "@/lib/number-format";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceHistoryPoint {
  id: number;
  linkId: number;
  rawPrice: number;
  currency: string;
  exchangeRate: number | null;
  finalCostArs: number;
  recordedAt: string;
}

interface OwnPriceHistoryPoint {
  id: number;
  productId: number;
  priceRegular: number | null;
  priceOffer: number | null;
  recordedAt: string;
}

interface SupplierLink {
  id: number;
  supplierCode: string;
  supplierStockQty: number;
  isActive: boolean;
  supplier: { id: number; code: string; name: string; currency: string; taxRate: number };
  price: { rawPrice: number; currency: string; finalCostArs: number; updatedAt: string } | null;
  priceHistory: PriceHistoryPoint[];
}

interface ProductDetail {
  id: number;
  woocommerceId: number | null;
  name: string;
  sku: string | null;
  eanUpc: string | null;
  category: string | null;
  brand: string | null;
  warranty: string | null;
  ivaRate: number;
  internalTaxRate: number;
  markupRegular: number;
  markupOffer: number | null;
  offerStart: string | null;
  offerEnd: string | null;
  ownPriceRegular: number | null;
  ownPriceOffer: number | null;
  ownCostUsd: number | null;
  localStock: number;
  hasSupplierStock: boolean;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  imageUrl: string | null;
  slug: string | null;
  storeUrl: string | null;
  productTags: string | null;
  attributes: string | null;
  shortDescription: string | null;
  description: string | null;
  wooCategoryIds: string | null;
  wooCategoryNames: string[];
  wooManualPrivate: boolean;
  wooLastSyncedAt: string | null;
  supplierLinks: SupplierLink[];
  ownPriceHistory: OwnPriceHistoryPoint[];
}

interface ExchangeRateData {
  sellRate: number;
  isOverride: boolean;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1", className)}>
      {children}
    </span>
  );
}


// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-8 w-20 bg-muted rounded" />
        <div className="h-7 w-96 bg-muted rounded" />
        <div className="ml-auto h-8 w-24 bg-muted rounded" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-72 bg-muted rounded-xl" />
          <div className="h-56 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-40 bg-muted rounded-xl" />
          <div className="h-72 bg-muted rounded-xl" />
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [wooSyncing, setWooSyncing] = useState(false);
  const [wooImporting, setWooImporting] = useState(false);
  const [wooImageUploading, setWooImageUploading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRateData | null>(null);

  const [editName, setEditName] = useState("");
  const [editSku, setEditSku] = useState("");
  const [editEanUpc, setEditEanUpc] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editBrand, setEditBrand] = useState("");
  const [editWarranty, setEditWarranty] = useState("");
  const [editWoocommerceId, setEditWoocommerceId] = useState("");
  const [wooIdLocked, setWooIdLocked] = useState(true);
  const [wooIdUnlockDialogOpen, setWooIdUnlockDialogOpen] = useState(false);
  const [editWooCategoryId, setEditWooCategoryId] = useState<number | null>(null);
  const [editWooCategoryIds, setEditWooCategoryIds] = useState("");
  const [editWeightKg, setEditWeightKg] = useState("");
  const [editLengthCm, setEditLengthCm] = useState("");
  const [editWidthCm, setEditWidthCm] = useState("");
  const [editHeightCm, setEditHeightCm] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const [editStoreUrl, setEditStoreUrl] = useState("");

  const [localStock, setLocalStock] = useState(0);
  const [markupRegular, setMarkupRegular] = useState(1);
  const [markupOffer, setMarkupOffer] = useState<string>("");
  const [ivaRate, setIvaRate] = useState(0.21);
  const [internalTaxRate, setInternalTaxRate] = useState(0);
  const [ownPriceRegular, setOwnPriceRegular] = useState<string>("");
  const [ownPriceOffer, setOwnPriceOffer] = useState<string>("");
  const [ownCostUsd, setOwnCostUsd] = useState<string>("");

  // Description state
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");

  useEffect(() => {
    Promise.all([
      fetch(`/api/products/${params.id}`).then((r) => r.json()),
      fetch("/api/exchange-rate").then((r) => r.json()),
    ])
      .then(([productData, rateData]) => {
        setProduct(productData);
        setEditName(productData.name || "");
        setEditSku(productData.sku || "");
        setEditEanUpc(productData.eanUpc || "");
        setEditCategory(productData.category || "");
        setEditBrand(productData.brand || "");
        setEditWarranty(productData.warranty || "");
        setLocalStock(productData.localStock);
        setMarkupRegular(productData.markupRegular);
        setMarkupOffer(productData.markupOffer?.toString() || "");
        setIvaRate(productData.ivaRate);
        setInternalTaxRate(productData.internalTaxRate || 0);
        setOwnPriceRegular(productData.ownPriceRegular?.toString() || "");
        setOwnPriceOffer(productData.ownPriceOffer?.toString() || "");
        setOwnCostUsd(productData.ownCostUsd?.toString() || "");
        setEditWoocommerceId(productData.woocommerceId?.toString() || "");
        setWooIdLocked(true);
        // WC category: leaf = last ID in the stored chain
        const catIds: number[] = productData.wooCategoryIds ? JSON.parse(productData.wooCategoryIds) : [];
        setEditWooCategoryId(catIds.length > 0 ? catIds[catIds.length - 1] : null);
        setEditWooCategoryIds(productData.wooCategoryIds || "");
        setEditWeightKg(productData.weightKg?.toString() || "");
        setEditLengthCm(productData.lengthCm?.toString() || "");
        setEditWidthCm(productData.widthCm?.toString() || "");
        setEditHeightCm(productData.heightCm?.toString() || "");
        setEditImageUrl(productData.imageUrl || "");
        setEditStoreUrl(productData.storeUrl || "");
        setShortDescription(productData.shortDescription || "");
        setDescription(productData.description || "");
        if (!rateData.error) setExchangeRate(rateData);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          sku: editSku || null,
          eanUpc: editEanUpc || null,
          category: editCategory || null,
          brand: editBrand || null,
          warranty: editWarranty || null,
          woocommerceId: editWoocommerceId ? parseInt(editWoocommerceId) : null,
          wooCategoryIds: editWooCategoryIds || null,
          weightKg: editWeightKg ? parseFloat(editWeightKg) : null,
          lengthCm: editLengthCm ? parseFloat(editLengthCm) : null,
          widthCm: editWidthCm ? parseFloat(editWidthCm) : null,
          heightCm: editHeightCm ? parseFloat(editHeightCm) : null,
          imageUrl: editImageUrl || null,
          storeUrl: editStoreUrl || null,
          localStock,
          markupRegular,
          markupOffer: markupOffer ? parseFloat(markupOffer) : null,
          ivaRate,
          internalTaxRate,
          ownPriceRegular: ownPriceRegular ? parseFloat(ownPriceRegular) : null,
          ownPriceOffer: ownPriceOffer ? parseFloat(ownPriceOffer) : null,
          ownCostUsd: ownCostUsd ? parseFloat(ownCostUsd) : null,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setProduct((prev) => (prev ? { ...prev, ...updated } : prev));
        toast.success("Producto actualizado");
      } else {
        toast.error("Error al actualizar");
      }
    } finally {
      setSaving(false);
    }
  };

  // ── WooCommerce: manual private toggle ───────────────────────────────────
  const handleToggleManualPrivate = async () => {
    if (!product) return;
    const newVal = !product.wooManualPrivate;
    try {
      const res = await fetch(`/api/products/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wooManualPrivate: newVal }),
      });
      if (res.ok) {
        setProduct((prev) => prev ? { ...prev, wooManualPrivate: newVal } : prev);
        toast.success(newVal ? "Producto pausado en tienda — se sincronizará como privado" : "Producto reactivado en tienda");
      } else {
        toast.error("Error al cambiar estado");
      }
    } catch {
      toast.error("Error al cambiar estado");
    }
  };

  // ── WooCommerce: push panel data → WC ────────────────────────────────────
  const handleWooSync = async () => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      toast.warning("⚡ Modo Demo: esta función conecta con WooCommerce en producción", { duration: 4000 });
      return;
    }
    setWooSyncing(true);
    try {
      const [payloadRes, cfgRes] = await Promise.all([
        fetch(`/api/woocommerce/sync-payload/${params.id}`),
        fetch("/api/woocommerce/config"),
      ]);
      if (!payloadRes.ok) throw new Error("Error obteniendo payload");
      const { wooId, data, safeguard } = await payloadRes.json() as {
        wooId: number;
        data: Record<string, unknown> & { attributes?: { id: number; name: string; options: string[]; visible: boolean }[]; regular_price?: string };
        safeguard: { blocked: boolean; reason?: string; newPrice?: number | null; oldPrice?: number | null };
      };

      // Safeguard: if blocked, route to review queue instead of syncing
      if (safeguard.blocked) {
        await fetch("/api/woocommerce/sync-blocked", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: parseInt(params.id as string, 10),
            wooId,
            productName: product?.name ?? "",
            reason: safeguard.reason,
            newPrice: safeguard.newPrice,
            oldPrice: safeguard.oldPrice,
            payload: { wooId, data },
          }),
        });
        toast.warning(`Sync bloqueado: ${safeguard.reason} — revisalo en Revisión WC`);
        return;
      }

      const cfg = await cfgRes.json() as { url: string; key: string; secret: string };
      const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;

      // Fetch current WC product to preserve existing attributes (only IVA gets replaced)
      const currentRes = await fetch(`${cfg.url}/wp-json/wc/v3/products/${wooId}?${auth}`);
      if (currentRes.ok) {
        const current = await currentRes.json() as { attributes?: { id: number; name: string; options: string[]; visible: boolean; variation: boolean; position: number }[] };
        const ivaAttr = data.attributes?.[0];
        if (ivaAttr && Array.isArray(current.attributes)) {
          // Keep all existing WC attributes, replace/add IVA
          const others = current.attributes.filter((a) => a.id !== ivaAttr.id);
          data.attributes = [...others, ivaAttr];
        }
      }

      const wcRes = await fetch(`${cfg.url}/wp-json/wc/v3/products/batch?${auth}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update: [{ id: wooId, ...data }] }),
      });
      if (!wcRes.ok) {
        const err = await wcRes.text();
        throw new Error(`WooCommerce: ${err.slice(0, 200)}`);
      }

      // Record the synced price for future safeguard checks
      const regularPriceNum = parseFloat(data.regular_price ?? "0");
      if (regularPriceNum > 0) {
        await fetch(`/api/woocommerce/sync-confirmed/${params.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regularPrice: regularPriceNum }),
        });
      }

      toast.success("Sincronizado con WooCommerce");
    } catch (err) {
      toast.error(`Error al sincronizar: ${String(err)}`);
    } finally {
      setWooSyncing(false);
    }
  };

  // ── WooCommerce: pull WC data → panel ────────────────────────────────────
  const handleWooImport = async () => {
    if (!product?.woocommerceId) return;
    setWooImporting(true);
    try {
      const cfgRes = await fetch("/api/woocommerce/config");
      const cfg = await cfgRes.json() as { url: string; key: string; secret: string };
      const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;
      const wcRes = await fetch(`${cfg.url}/wp-json/wc/v3/products/${product.woocommerceId}?${auth}`);
      if (!wcRes.ok) throw new Error(`WooCommerce: HTTP ${wcRes.status}`);
      const wcProduct = await wcRes.json();
      const importRes = await fetch(`/api/woocommerce/import-product/${params.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wcProduct),
      });
      if (!importRes.ok) throw new Error("Error guardando datos");
      // Refresh product
      const updated = await fetch(`/api/products/${params.id}`).then((r) => r.json()) as ProductDetail;
      setProduct(updated);
      setEditName(updated.name || "");
      setEditSku(updated.sku || "");
      setEditCategory(updated.category || "");
      setEditBrand(updated.brand || "");
      setEditWarranty(updated.warranty || "");
      setEditImageUrl(updated.imageUrl || "");
      setEditStoreUrl(updated.storeUrl || "");
      toast.success("Datos importados desde WooCommerce");
    } catch (err) {
      toast.error(`Error al importar: ${String(err)}`);
    } finally {
      setWooImporting(false);
    }
  };

  const handleWooImageUpload = async () => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      toast.warning("⚡ Modo Demo: el procesamiento de imágenes requiere WooCommerce", { duration: 4000 });
      return;
    }
    if (!product?.imageUrl) { toast.error("El producto no tiene imagen cargada en el panel"); return; }
    setWooImageUploading(true);
    try {
      const res = await fetch("/api/woocommerce/upload-product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json() as { results?: { imageType: string }[]; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error al subir imagen");
      const uploaded = data.results?.length ?? 0;
      if (uploaded > 0 && (!data.errors || data.errors.length === 0)) {
        toast.success(`${uploaded} imagen${uploaded > 1 ? "es" : ""} subida${uploaded > 1 ? "s" : ""} a WooCommerce`);
      } else if (uploaded > 0) {
        toast.warning(`${uploaded} imagen${uploaded > 1 ? "es" : ""} subida${uploaded > 1 ? "s" : ""}. Errores: ${data.errors?.join(", ")}`);
      } else {
        throw new Error(data.errors?.join("; ") ?? "Error desconocido");
      }
    } catch (err) {
      toast.error(`Error al subir imagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setWooImageUploading(false);
    }
  };

  const handleGenerateDescription = async () => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
      toast.warning("⚡ Modo Demo: la generación con IA requiere una clave Gemini", { duration: 4000 });
      return;
    }
    setGeneratingDesc(true);
    try {
      const res = await fetch(`/api/products/${params.id}/generate-description`, { method: "POST" });
      const data = await res.json() as { description?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Error al generar");
      setDescription(data.description ?? "");
      toast.success("Descripción generada con IA");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al generar descripción");
    } finally {
      setGeneratingDesc(false);
    }
  };

  const handleSaveDescription = async () => {
    setSavingDesc(true);
    try {
      const res = await fetch(`/api/products/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shortDescription, description }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      toast.success("Descripción guardada");
    } catch {
      toast.error("Error al guardar descripción");
    } finally {
      setSavingDesc(false);
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Package className="h-12 w-12 text-muted-foreground/30" />
        <p className="text-muted-foreground">Producto no encontrado</p>
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
      </div>
    );
  }

  // ── Supplier groups ──────────────────────────────────────────────────────────
  // Con stock: active + stock > 0 + has price → sorted by finalCostArs ASC
  const suppliersWithStock = product.supplierLinks
    .filter((l) => l.isActive && l.supplierStockQty > 0 && l.price != null)
    .sort((a, b) => a.price!.finalCostArs - b.price!.finalCostArs);

  // Sin stock: active but no stock (or no price) — shown without price
  const suppliersNoStock = product.supplierLinks
    .filter((l) => l.isActive && (l.supplierStockQty === 0 || l.price == null));

  // Best = cheapest with stock
  const bestLink = suppliersWithStock[0] ?? null;

  // ── Price calculation (for calculator sidebar) ────────────────────────────
  const dolar = exchangeRate?.sellRate || 1;
  const rawPriceUSD = bestLink?.price?.rawPrice ?? 0;
  const iibbRate = bestLink?.supplier.taxRate ?? 0;
  const isUSD = bestLink?.price?.currency === "USD";
  const taxMultiplier = 1 + ivaRate + iibbRate + internalTaxRate;
  const supplierCostARS = bestLink?.price?.finalCostArs ?? 0;
  const clientPrice = supplierCostARS * markupRegular;
  const clientOfferPrice = markupOffer ? supplierCostARS * parseFloat(markupOffer) : null;
  const margin = clientPrice - supplierCostARS;
  const marginPct = supplierCostARS > 0 ? (margin / supplierCostARS) * 100 : 0;

  // ── Attribute rendering ────────────────────────────────────────────────────
  let parsedAttrs: [string, unknown][] = [];
  let parsedTags: string[] = [];
  try { parsedAttrs = Object.entries(JSON.parse(product.attributes || "{}")); } catch {}
  try { parsedTags = JSON.parse(product.productTags || "[]"); } catch {}

  const isTruthy = (v: unknown) => {
    if (!v) return false;
    const s = String(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s !== "no" && s !== "false" && s !== "0";
  };
  const renderAttrLabel = (k: string, v: unknown) => {
    if (k === "socket") return `Socket: ${v}`;
    if (k === "memoryType") return `Mem: ${v}`;
    if (k === "gpuIntegrado") return isTruthy(v) ? "GPU integrada" : "Sin GPU integrada";
    if (k === "coolerStock") return isTruthy(v) ? "Con cooler" : "Sin cooler";
    if (k === "modular") return isTruthy(v) ? "Modular" : "No modular";
    return `${k}: ${v}`;
  };

  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mt-0.5 shrink-0">
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>

        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight">{product.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {product.sku && (
              <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {product.sku}
              </span>
            )}
            {product.category && <Badge variant="secondary" className="text-xs">{product.category}</Badge>}
            {product.brand && <Badge variant="outline" className="text-xs">{product.brand}</Badge>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {(product.storeUrl || editStoreUrl) && (
            <a href={editStoreUrl || product.storeUrl || ""} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="cursor-pointer">
                <ExternalLink className="h-4 w-4 mr-1" /> Ver en tienda
              </Button>
            </a>
          )}
          {product.woocommerceId && !isViewer && (
            <>
              <Button
                variant={product.wooManualPrivate ? "default" : "outline"}
                size="sm"
                onClick={handleToggleManualPrivate}
                className={`cursor-pointer ${product.wooManualPrivate ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500" : ""}`}
                title={product.wooManualPrivate ? "Producto pausado manualmente — click para reactivar" : "Pausar producto en tienda"}
              >
                {product.wooManualPrivate ? (
                  <><EyeOff className="h-4 w-4 mr-1" /> Pausado</>
                ) : (
                  <><Eye className="h-4 w-4 mr-1" /> Visible</>
                )}
              </Button>
              <Button variant="outline" size="sm" onClick={handleWooImport} disabled={wooImporting} className="cursor-pointer">
                <Download className={`h-4 w-4 mr-1 ${wooImporting ? "animate-spin" : ""}`} />
                {wooImporting ? "Importando…" : "Importar WC"}
              </Button>
              <Button variant="outline" size="sm" onClick={handleWooSync} disabled={wooSyncing} className="cursor-pointer">
                <ShoppingCart className={`h-4 w-4 mr-1 ${wooSyncing ? "animate-spin" : ""}`} />
                {wooSyncing ? "Sincronizando…" : "Sync WC"}
              </Button>
              {product.imageUrl && (
                <Button variant="outline" size="sm" onClick={handleWooImageUpload} disabled={wooImageUploading} className="cursor-pointer">
                  <ImageUp className={`h-4 w-4 mr-1 ${wooImageUploading ? "animate-spin" : ""}`} />
                  {wooImageUploading ? "Subiendo…" : "Subir imagen"}
                </Button>
              )}
            </>
          )}
          {!isViewer && (
            <Button onClick={handleSave} disabled={saving} size="sm" className="cursor-pointer min-w-[100px]">
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ═══ Left column (2/3) ══════════════════════════════════════════════ */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── Identificación ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Identificación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Name */}
              <div>
                <FieldLabel>Nombre</FieldLabel>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isViewer}
                  className="font-medium"
                />
              </div>

              {/* SKU | EAN */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <FieldLabel>SKU</FieldLabel>
                  <Input
                    value={editSku}
                    onChange={(e) => setEditSku(e.target.value)}
                    disabled={isViewer}
                    className="font-mono text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>EAN / UPC</FieldLabel>
                  <Input
                    value={editEanUpc}
                    onChange={(e) => setEditEanUpc(e.target.value)}
                    disabled={isViewer}
                    className="font-mono text-sm"
                  />
                </div>
              </div>

              {/* Categoría | Marca | Garantía */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <FieldLabel>Categoría</FieldLabel>
                  <Input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} disabled={isViewer} />
                </div>
                <div>
                  <FieldLabel>Marca</FieldLabel>
                  <Input value={editBrand} onChange={(e) => setEditBrand(e.target.value)} disabled={isViewer} />
                </div>
                <div>
                  <FieldLabel>Garantía</FieldLabel>
                  <Input value={editWarranty} onChange={(e) => setEditWarranty(e.target.value)} disabled={isViewer} />
                </div>
              </div>

              {/* Attributes + Tags */}
              {(parsedAttrs.length > 0 || parsedTags.length > 0) && (
                <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                  {parsedAttrs.map(([k, v]) => (
                    <Badge key={k} variant="secondary" className="text-xs">
                      {renderAttrLabel(k, v)}
                    </Badge>
                  ))}
                  {parsedTags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── WooCommerce & Logística ─────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                WooCommerce & Logística
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* WooCommerce ID — requiere confirmación para editar */}
              <div>
                <FieldLabel>WooCommerce ID</FieldLabel>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    type="number"
                    value={editWoocommerceId}
                    onChange={(e) => setEditWoocommerceId(e.target.value)}
                    disabled={isViewer || wooIdLocked}
                    placeholder="Sin ID"
                    className="font-mono text-sm max-w-[180px]"
                  />
                  {!isViewer && (
                    <button
                      type="button"
                      title={wooIdLocked ? "Desbloquear para editar" : "Volver a bloquear"}
                      onClick={() => {
                        if (wooIdLocked) {
                          setWooIdUnlockDialogOpen(true);
                        } else {
                          setWooIdLocked(true);
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {wooIdLocked
                        ? <Lock className="h-4 w-4" />
                        : <Unlock className="h-4 w-4 text-amber-500" />
                      }
                    </button>
                  )}
                  {product.wooLastSyncedAt && (
                    <span className="text-xs text-muted-foreground">
                      Último sync: {new Date(product.wooLastSyncedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </span>
                  )}
                </div>
                {/* WooCommerce categories breadcrumb (display) */}
                {product.wooCategoryNames && product.wooCategoryNames.length > 0 && (
                  <div className="mt-1.5 flex items-center gap-1 flex-wrap">
                    {product.wooCategoryNames.map((name, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs text-muted-foreground">
                        {i > 0 && <span className="text-muted-foreground/40">›</span>}
                        <span className="bg-muted px-1.5 py-0.5 rounded">{name}</span>
                      </span>
                    ))}
                  </div>
                )}
                {/* WooCommerce category picker (editable) */}
                {!isViewer && (
                  <div className="mt-2">
                    <FieldLabel>Categoría WooCommerce</FieldLabel>
                    <WooCategoryPicker
                      value={editWooCategoryId}
                      onChange={(id, allIds) => {
                        setEditWooCategoryId(id);
                        setEditWooCategoryIds(allIds.length > 0 ? JSON.stringify(allIds) : "");
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Peso y Dimensiones */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <FieldLabel>Peso (kg)</FieldLabel>
                  <Input
                    type="number"
                    step="0.01"
                    value={editWeightKg}
                    onChange={(e) => setEditWeightKg(e.target.value)}
                    disabled={isViewer}
                    placeholder="—"
                  />
                </div>
                <div>
                  <FieldLabel>Largo (cm)</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    value={editLengthCm}
                    onChange={(e) => setEditLengthCm(e.target.value)}
                    disabled={isViewer}
                    placeholder="—"
                  />
                </div>
                <div>
                  <FieldLabel>Ancho (cm)</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    value={editWidthCm}
                    onChange={(e) => setEditWidthCm(e.target.value)}
                    disabled={isViewer}
                    placeholder="—"
                  />
                </div>
                <div>
                  <FieldLabel>Alto (cm)</FieldLabel>
                  <Input
                    type="number"
                    step="0.1"
                    value={editHeightCm}
                    onChange={(e) => setEditHeightCm(e.target.value)}
                    disabled={isViewer}
                    placeholder="—"
                  />
                </div>
              </div>

              {/* Imagen y URL tienda */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <FieldLabel>URL Imagen</FieldLabel>
                  <Input
                    value={editImageUrl}
                    onChange={(e) => setEditImageUrl(e.target.value)}
                    disabled={isViewer}
                    placeholder="https://..."
                    className="text-sm"
                  />
                </div>
                <div>
                  <FieldLabel>URL Tienda</FieldLabel>
                  <Input
                    value={editStoreUrl}
                    onChange={(e) => setEditStoreUrl(e.target.value)}
                    disabled={isViewer}
                    placeholder="https://..."
                    className="text-sm"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Pricing & Stock ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Pricing & Stock
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Main settings row */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <FieldLabel>Stock Local</FieldLabel>
                  <Input
                    type="number"
                    value={localStock}
                    onChange={(e) => setLocalStock(parseInt(e.target.value) || 0)}
                    disabled={isViewer}
                  />
                </div>
                <div>
                  <FieldLabel>Markup Regular</FieldLabel>
                  <Input
                    type="number"
                    step="0.01"
                    value={markupRegular}
                    onChange={(e) => setMarkupRegular(parseFloat(e.target.value) || 1)}
                    disabled={isViewer}
                  />
                </div>
                <div>
                  <FieldLabel>Markup Oferta</FieldLabel>
                  <Input
                    type="number"
                    step="0.01"
                    value={markupOffer}
                    onChange={(e) => setMarkupOffer(e.target.value)}
                    disabled={isViewer}
                    placeholder="Sin oferta"
                  />
                </div>
                <div>
                  <FieldLabel>IVA ({(ivaRate * 100).toFixed(1)}%)</FieldLabel>
                  <Input
                    type="number"
                    step="0.001"
                    value={ivaRate}
                    onChange={(e) => setIvaRate(parseFloat(e.target.value) || 0.21)}
                    disabled={isViewer}
                  />
                </div>
                <div>
                  <FieldLabel>Imp. Internos ({(internalTaxRate * 100).toFixed(1)}%)</FieldLabel>
                  <Input
                    type="number"
                    step="0.001"
                    value={internalTaxRate}
                    onChange={(e) => setInternalTaxRate(parseFloat(e.target.value) || 0)}
                    disabled={isViewer}
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Own price — dashed border section */}
              <div className="rounded-lg border border-dashed border-border/60 p-4 space-y-3 bg-muted/20">
                <div>
                  <p className="text-sm font-medium">Precio Propio</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Activar cuando tenés stock propio y querés fijar el precio manualmente.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <FieldLabel>Costo USD</FieldLabel>
                    <Input
                      type="number"
                      step="0.01"
                      value={ownCostUsd}
                      onChange={(e) => setOwnCostUsd(e.target.value)}
                      disabled={isViewer}
                      placeholder="Costo de compra"
                    />
                  </div>
                  <div>
                    <FieldLabel>Precio Regular (ARS)</FieldLabel>
                    <Input
                      type="number"
                      step="0.01"
                      value={ownPriceRegular}
                      onChange={(e) => setOwnPriceRegular(e.target.value)}
                      disabled={isViewer}
                      placeholder="Sin precio propio"
                    />
                  </div>
                  <div>
                    <FieldLabel>Precio Oferta (ARS)</FieldLabel>
                    <Input
                      type="number"
                      step="0.01"
                      value={ownPriceOffer}
                      onChange={(e) => setOwnPriceOffer(e.target.value)}
                      disabled={isViewer}
                      placeholder="Sin oferta"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ── Proveedores Vinculados ──────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Proveedores Vinculados
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  {suppliersWithStock.length > 0 && (
                    <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">
                      {suppliersWithStock.length} con stock
                    </Badge>
                  )}
                  {suppliersNoStock.length > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {suppliersNoStock.length} sin stock
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            {product.supplierLinks.filter((l) => l.isActive).length === 0 ? (
              <CardContent>
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground">
                  <Package className="h-8 w-8 opacity-25" />
                  <p className="text-sm">Sin proveedores vinculados</p>
                </div>
              </CardContent>
            ) : (
              <CardContent className="p-0">

                {/* ── Con stock ────────────────────────────────────────────── */}
                {suppliersWithStock.length > 0 && (
                  <div>
                    <div className="px-5 py-2 border-t bg-emerald-50/50 dark:bg-emerald-950/10">
                      <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">
                        Con stock — ordenado por precio
                      </p>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead className="pl-5">Proveedor</TableHead>
                          <TableHead>Código</TableHead>
                          <TableHead className="text-right">Raw / Mon.</TableHead>
                          <TableHead className="text-right">IIBB</TableHead>
                          <TableHead className="text-right">Costo Final ARS</TableHead>
                          <TableHead className="text-right">Precio Cliente</TableHead>
                          <TableHead className="text-center pr-5">Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {suppliersWithStock.map((link, idx) => {
                          const isBest = idx === 0;
                          const clientPriceEst = link.price
                            ? link.price.finalCostArs * markupRegular
                            : null;
                          return (
                            <TableRow
                              key={link.id}
                              className={isBest ? "bg-emerald-50/40 dark:bg-emerald-950/10" : ""}
                            >
                              <TableCell className="pl-5 py-3">
                                <div className="flex items-center gap-2">
                                  {isBest && (
                                    <span className="shrink-0 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950 px-1.5 py-0.5 rounded">
                                      ★ MEJOR
                                    </span>
                                  )}
                                  <Link
                                    href={`/suppliers/${link.supplier.id}`}
                                    className="text-sm font-medium text-primary hover:underline"
                                  >
                                    {link.supplier.code}
                                  </Link>
                                </div>
                              </TableCell>
                              <TableCell className="py-3 font-mono text-xs text-muted-foreground">
                                {link.supplierCode}
                              </TableCell>
                              <TableCell className="py-3 text-right">
                                <span className="text-sm">{formatArgNumber(link.price!.rawPrice)}</span>
                                <Badge variant="outline" className="ml-1.5 text-[10px]">
                                  {link.price!.currency}
                                </Badge>
                              </TableCell>
                              <TableCell className="py-3 text-right text-sm text-muted-foreground">
                                {(link.supplier.taxRate * 100).toFixed(1)}%
                              </TableCell>
                              <TableCell className="py-3 text-right font-semibold tabular-nums">
                                {formatARS(link.price!.finalCostArs)}
                              </TableCell>
                              <TableCell className="py-3 text-right text-sm text-muted-foreground tabular-nums">
                                {clientPriceEst ? formatClientPrice(clientPriceEst) : "—"}
                              </TableCell>
                              <TableCell className="py-3 text-center pr-5">
                                <Badge variant="secondary" className="text-xs tabular-nums">
                                  {link.supplierStockQty}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* ── Sin stock ─────────────────────────────────────────────── */}
                {suppliersNoStock.length > 0 && (
                  <div>
                    <div className={cn("px-5 py-2 border-t", suppliersWithStock.length > 0 && "border-t")}>
                      <p className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wide">
                        Sin stock
                      </p>
                    </div>
                    <div className="opacity-50">
                      {suppliersNoStock.map((link, idx) => (
                        <div
                          key={link.id}
                          className={cn(
                            "flex items-center justify-between px-5 py-2.5 text-sm",
                            idx < suppliersNoStock.length - 1 && "border-b border-border/40"
                          )}
                        >
                          <Link
                            href={`/suppliers/${link.supplier.id}`}
                            className="font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {link.supplier.code}
                          </Link>
                          <span className="font-mono text-xs text-muted-foreground">
                            {link.supplierCode}
                          </span>
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Sin stock
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </CardContent>
            )}
          </Card>

          {/* ── Price History Chart ─────────────────────────────────────────── */}
          <PriceHistoryChart
            supplierLinks={product.supplierLinks}
            ownPriceHistory={product.ownPriceHistory || []}
            markupRegular={markupRegular}
            markupOffer={markupOffer ? parseFloat(markupOffer) : null}
            isOnOffer={Boolean(product.markupOffer && product.offerStart && product.offerEnd)}
          />

          {/* ── Descripción de tienda ───────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    Descripción de tienda
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    HTML para WooCommerce, generado con IA y búsqueda oficial del fabricante.
                  </CardDescription>
                </div>
                {!isViewer && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateDescription}
                    disabled={generatingDesc}
                    className="h-7 text-xs gap-1.5 shrink-0"
                  >
                    {generatingDesc ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {generatingDesc ? "Generando..." : "Generar con IA"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Tab toggle — oculto para VIEWER */}
              {!isViewer && (
                <div className="flex gap-1 border rounded-md p-0.5 w-fit">
                  <button
                    onClick={() => setDescTab("edit")}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${descTab === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setDescTab("preview")}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${descTab === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Vista previa
                  </button>
                </div>
              )}

              {!isViewer && descTab === "edit" ? (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={generatingDesc ? "Generando con IA..." : "Todavía no hay descripción. Hacé clic en 'Generar con IA'."}
                  className="text-xs font-mono min-h-[200px] resize-y"
                  disabled={generatingDesc}
                />
              ) : (
                <div
                  className="p-3 rounded-md border bg-muted/20 text-sm prose prose-sm max-w-none dark:prose-invert min-h-[200px]"
                  dangerouslySetInnerHTML={{ __html: description || "<p class='text-muted-foreground italic'>Sin descripción todavía.</p>" }}
                />
              )}

              <div className="flex gap-2 pt-1">
                {!isViewer && (
                  <Button
                    size="sm"
                    onClick={handleSaveDescription}
                    disabled={savingDesc || generatingDesc}
                    className="flex-1"
                  >
                    {savingDesc ? (
                      <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-1.5" />
                    )}
                    Guardar descripción
                  </Button>
                )}
                {description && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(description); toast.success("Descripción copiada"); }}
                    title="Copiar descripción"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══ Sidebar (1/3) ════════════════════════════════════════════════ */}
        <div className="space-y-4">

          {/* Image */}
          {product.imageUrl && (
            <Card>
              <CardContent className="p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full rounded-md object-contain max-h-48"
                />
              </CardContent>
            </Card>
          )}

          {/* ── Price Calculator ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Calculator className="h-4 w-4 text-muted-foreground" />
                Calculadora de Precio
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Own price block */}
              {(product.ownPriceRegular || product.ownPriceOffer || product.ownCostUsd) && (
                <>
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3.5 space-y-3">
                    <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">
                      Stock Propio
                    </Badge>

                    {product.ownCostUsd && (
                      <div className="text-sm space-y-1 pb-2.5 border-b border-emerald-200 dark:border-emerald-800">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Costo USD:</span>
                          <span className="font-mono">$ {formatArgNumber(product.ownCostUsd)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Costo ARS:</span>
                          <span className="font-mono">{formatARS(product.ownCostUsd * dolar)}</span>
                        </div>
                      </div>
                    )}

                    {product.ownPriceRegular && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-medium">Precio Regular</span>
                        <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                          {formatARS(product.ownPriceRegular)}
                        </span>
                      </div>
                    )}
                    {product.ownPriceOffer && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-medium">Precio Oferta</span>
                        <span className="text-lg font-bold text-orange-500 tabular-nums">
                          {formatARS(product.ownPriceOffer)}
                        </span>
                      </div>
                    )}

                    {product.ownCostUsd && (product.ownPriceRegular || product.ownPriceOffer) && (() => {
                      const ownCostArs = product.ownCostUsd * dolar;
                      const effectivePrice = product.ownPriceOffer ?? product.ownPriceRegular!;
                      const label = product.ownPriceOffer ? "Margen oferta" : "Margen";
                      const m = effectivePrice - ownCostArs;
                      const mp = (m / ownCostArs) * 100;
                      return (
                        <div className="flex justify-between text-xs pt-1 border-t border-emerald-200 dark:border-emerald-800">
                          <span className="text-muted-foreground">{label}</span>
                          <span className={mp > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>
                            {formatARS(m)} ({mp.toFixed(1)}%)
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  <Separator />
                </>
              )}

              {/* Supplier-based calculation */}
              {bestLink ? (
                <div className="space-y-3">

                  {/* Step breakdown */}
                  <div className="bg-muted/40 rounded-lg p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        {isUSD ? "Precio USD" : "Precio ARS"}
                      </span>
                      <span className="font-mono">$ {formatArgNumber(rawPriceUSD)}</span>
                    </div>
                    {isUSD && (
                      <>
                        <div className="flex items-center justify-center text-muted-foreground/70">
                          <ArrowRight className="h-3 w-3 mr-1" />
                          × (1 + {(ivaRate * 100).toFixed(1)}% IVA + {(iibbRate * 100).toFixed(1)}% IIBB
                          {internalTaxRate > 0 ? ` + ${(internalTaxRate * 100).toFixed(1)}% Int` : ""})
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Con impuestos:</span>
                          <span className="font-mono">$ {formatArgNumber(rawPriceUSD * taxMultiplier)}</span>
                        </div>
                        <div className="flex items-center justify-center text-muted-foreground/70">
                          <ArrowRight className="h-3 w-3 mr-1" />
                          × {formatArgNumber(dolar)} (dólar{exchangeRate?.isOverride ? " manual" : ""})
                        </div>
                      </>
                    )}
                    <div className="flex justify-between font-medium pt-1 border-t border-border/60">
                      <span>Costo proveedor ARS</span>
                      <span className="font-mono">{formatARS(supplierCostARS)}</span>
                    </div>
                  </div>

                  {/* Best supplier label */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Mejor proveedor</span>
                    <Badge variant="outline" className="font-medium">
                      {bestLink.supplier.code}
                    </Badge>
                  </div>

                  {/* Markup arrow */}
                  <div className="flex items-center justify-center text-xs text-muted-foreground">
                    <ArrowRight className="h-3 w-3 mr-1" />
                    × {markupRegular} (markup regular)
                  </div>

                  {/* Client price — hero */}
                  <div className="rounded-lg border bg-card p-3.5 space-y-2">
                    <div className="flex justify-between items-baseline">
                      <span className="text-sm font-medium">Precio Cliente</span>
                      <span className={cn(
                        "text-xl font-bold tabular-nums",
                        product.ownPriceRegular ? "text-muted-foreground line-through text-base" : "text-primary"
                      )}>
                        {formatClientPrice(clientPrice)}
                      </span>
                    </div>
                    {clientOfferPrice && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-sm font-medium">Precio Oferta</span>
                        <span className={cn(
                          "text-xl font-bold tabular-nums",
                          product.ownPriceOffer ? "text-muted-foreground line-through text-base" : "text-orange-500"
                        )}>
                          {formatClientPrice(clientOfferPrice)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Margin pills */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Margen Regular</span>
                      <span className={cn(
                        "font-semibold tabular-nums",
                        marginPct >= 15 ? "text-emerald-600" : marginPct >= 10 ? "text-amber-600" : "text-red-500"
                      )}>
                        {formatARS(margin)} ({marginPct.toFixed(1)}%)
                      </span>
                    </div>
                    {clientOfferPrice && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Margen Oferta</span>
                        <span className={cn(
                          "font-semibold tabular-nums",
                          (clientOfferPrice - supplierCostARS) / supplierCostARS * 100 >= 10
                            ? "text-amber-600"
                            : "text-red-500"
                        )}>
                          {formatARS(clientOfferPrice - supplierCostARS)} (
                          {(((clientOfferPrice - supplierCostARS) / supplierCostARS) * 100).toFixed(1)}%)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : !product.ownPriceRegular && !product.ownPriceOffer ? (
                <p className="text-center text-xs text-muted-foreground py-4">
                  Sin precios de proveedores ni precio propio
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Offer info */}
          {product.offerStart && product.offerEnd && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Oferta Activa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Inicio</span>
                  <span className="font-mono text-xs">{product.offerStart}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fin</span>
                  <span className="font-mono text-xs">{product.offerEnd}</span>
                </div>
                {product.markupOffer && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Markup Oferta</span>
                    <span className="font-medium">{product.markupOffer}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* ── WooCommerce Sync History ────────────────────────────────────── */}
      {product.woocommerceId && (
        <WooSyncHistory productId={product.id} />
      )}

      {/* ── WooCommerce ID unlock confirmation dialog ──────────────────── */}
      <Dialog open={wooIdUnlockDialogOpen} onOpenChange={setWooIdUnlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Unlock className="h-4 w-4 text-amber-500" />
              Desbloquear WooCommerce ID
            </DialogTitle>
            <DialogDescription>
              Modificar el WooCommerce ID puede desincronizar este producto con la tienda.
              Asegurate de que el ID corresponde al producto correcto en WooCommerce.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWooIdUnlockDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setWooIdLocked(false);
                setWooIdUnlockDialogOpen(false);
              }}
            >
              Desbloquear y editar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Woo Sync History ─────────────────────────────────────────────────────────

interface WooSyncHistoryEntry {
  id: number;
  status: "pending" | "approved" | "rejected";
  reason: string;
  newPrice: number | null;
  oldPrice: number | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

interface WooSyncHistoryData {
  lastSync: { syncedAt: string; syncedPrice: number | null } | null;
  blockedHistory: WooSyncHistoryEntry[];
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending:  { label: "Pendiente", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200" },
  approved: { label: "Aprobado",  className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200" },
  rejected: { label: "Rechazado", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200" },
};

function WooSyncHistory({ productId }: { productId: number }) {
  const [data, setData] = useState<WooSyncHistoryData | null>(null);

  useEffect(() => {
    fetch(`/api/products/${productId}/woo-sync-history`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [productId]);

  if (!data) return null;
  if (!data.lastSync && data.blockedHistory.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <ShoppingCart className="h-4 w-4" />
          Historial de Sync WooCommerce
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Last auto-sync */}
        {data.lastSync && (
          <div className="flex items-center gap-3 text-sm bg-muted/50 rounded-lg px-3 py-2">
            <span className="text-muted-foreground">Último sync automático:</span>
            <span className="font-medium">
              {new Date(data.lastSync.syncedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
            {data.lastSync.syncedPrice != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-medium text-green-600">{formatARS(data.lastSync.syncedPrice)}</span>
              </>
            )}
          </div>
        )}

        {/* Blocked sync history table */}
        {data.blockedHistory.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead className="text-right">Precio anterior</TableHead>
                <TableHead className="text-right">Precio nuevo</TableHead>
                <TableHead>Revisado por</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.blockedHistory.map((entry) => {
                const pct = entry.oldPrice && entry.newPrice
                  ? Math.round((entry.newPrice / entry.oldPrice - 1) * 100)
                  : null;
                const badge = STATUS_BADGE[entry.status] ?? STATUS_BADGE.pending;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate" title={entry.reason}>
                      {entry.reason}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {entry.oldPrice ? formatARS(entry.oldPrice) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      <span>
                        {entry.newPrice ? formatARS(entry.newPrice) : "—"}
                      </span>
                      {pct != null && (
                        <span className={`ml-1.5 text-[11px] ${pct < 0 ? "text-red-500" : "text-green-600"}`}>
                          {pct > 0 ? "+" : ""}{pct}%
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.reviewedBy ?? (entry.reviewedAt ? "—" : "")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Price History Chart ───────────────────────────────────────────────────────

const CHART_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#ca8a04", "#9333ea", "#0891b2"];

interface PriceHistoryChartProps {
  supplierLinks: SupplierLink[];
  ownPriceHistory: OwnPriceHistoryPoint[];
  markupRegular: number;
  markupOffer: number | null;
  isOnOffer: boolean;
}

function PriceHistoryChart({
  supplierLinks,
  ownPriceHistory,
  markupRegular,
  markupOffer,
  isOnOffer,
}: PriceHistoryChartProps) {
  const linksWithHistory = supplierLinks.filter(
    (l) => l.priceHistory && l.priceHistory.length > 0 && l.supplierStockQty > 0
  );
  const hasOwnHistory = ownPriceHistory && ownPriceHistory.length > 0;
  const suppliersWithStock = new Set(
    supplierLinks
      .filter((l) => l.isActive && l.supplierStockQty > 0)
      .map((l) => l.supplier.code)
  );

  const allLines: { key: string; label: string; color: string; dashed?: boolean }[] = [];
  for (let i = 0; i < linksWithHistory.length; i++) {
    const link = linksWithHistory[i];
    allLines.push({ key: link.supplier.code, label: link.supplier.code, color: CHART_COLORS[i % CHART_COLORS.length] });
  }
  if (hasOwnHistory) {
    allLines.push({ key: "Precio Propio", label: "Precio Propio", color: "#059669", dashed: true });
  }
  const hasStockSupplierHistory = linksWithHistory.some((l) => suppliersWithStock.has(l.supplier.code));
  if (hasStockSupplierHistory) {
    allLines.push({ key: "Precio Cliente", label: "Precio Cliente", color: "#f97316", dashed: true });
  }

  const [visibleLines, setVisibleLines] = useState<Set<string>>(
    () => new Set(allLines.map((l) => l.key))
  );

  if (linksWithHistory.length === 0 && !hasOwnHistory) return null;

  const dateMap = new Map<string, Record<string, number | null>>();
  for (const link of linksWithHistory) {
    for (const point of link.priceHistory) {
      const date = point.recordedAt.slice(0, 10);
      if (!dateMap.has(date)) dateMap.set(date, {});
      dateMap.get(date)![link.supplier.code] = point.finalCostArs;
    }
  }
  for (const point of ownPriceHistory) {
    const date = point.recordedAt.slice(0, 10);
    if (!dateMap.has(date)) dateMap.set(date, {});
    dateMap.get(date)!["Precio Propio"] = point.priceOffer ?? point.priceRegular ?? 0;
  }

  const markup = isOnOffer && markupOffer ? markupOffer : markupRegular;
  if (hasStockSupplierHistory) {
    const stockCodes = Array.from(suppliersWithStock);
    Array.from(dateMap.entries()).forEach(([, values]) => {
      let bestCost: number | null = null;
      for (const code of stockCodes) {
        const cost = values[code];
        if (cost != null && (bestCost === null || cost < bestCost)) bestCost = cost;
      }
      if (bestCost !== null) values["Precio Cliente"] = Math.round(bestCost * markup * 100) / 100;
    });
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, ...values }));

  const toggleLine = (key: string) => {
    setVisibleLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Historial de Precios
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 mb-4">
          {allLines.map((line) => {
            const visible = visibleLines.has(line.key);
            return (
              <button
                key={line.key}
                type="button"
                onClick={() => toggleLine(line.key)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer"
                style={{
                  backgroundColor: visible ? line.color : "transparent",
                  color: visible ? "#fff" : line.color,
                  border: `1.5px solid ${line.color}`,
                  opacity: visible ? 1 : 0.55,
                }}
              >
                <span
                  className="inline-block w-3 h-0.5 rounded"
                  style={{
                    backgroundColor: visible ? "#fff" : line.color,
                    ...(line.dashed
                      ? { borderTop: `2px dashed ${visible ? "#fff" : line.color}`, backgroundColor: "transparent", height: 0 }
                      : {}),
                  }}
                />
                {line.label}
              </button>
            );
          })}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toLocaleString("es-AR")}`} />
            <Tooltip
              formatter={(value) => [
                `$${Number(value).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`,
              ]}
              labelFormatter={(label) => `Fecha: ${label}`}
            />
            <Legend />
            {allLines
              .filter((l) => visibleLines.has(l.key))
              .map((line) => (
                <Line
                  key={line.key}
                  type="monotone"
                  dataKey={line.key}
                  stroke={line.color}
                  strokeWidth={line.dashed ? 2.5 : 2}
                  dot={{ r: line.dashed ? 3.5 : 2.5 }}
                  connectNulls
                  {...(line.dashed ? { strokeDasharray: "5 5" } : {})}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
