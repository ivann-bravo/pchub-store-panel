"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/layout/page-header";
import {
  CheckCircle2, XCircle, RefreshCw, ShoppingCart, Tag, Layers, ChevronRight, ChevronDown,
  Server, Download, Zap, Clock, AlertCircle, ExternalLink,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WooConfig {
  configured: boolean;
  url: string;
  key: string;
  secret: string;
}

interface ConnectionState {
  loading: boolean;
  connected: boolean;
  storeName?: string;
  error?: string;
}

interface ServerTestState {
  loading: boolean;
  ok?: boolean;
  latencyMs?: number;
  wpVersion?: string | null;
  serverIp?: string | null;
  productCount?: number | null;
  status?: number;
  error?: string;
  body?: string;
}

interface BulkImportState {
  running: boolean;
  done: boolean;
  total: number;
  processed: number;
  errors: { id: number; name: string; error: string }[];
  onlyPending: boolean;
}

interface SyncStatus {
  total: number;
  pending: number;
  neverSynced: number;
  lastSyncedAt: string | null;
}

interface WooCategory {
  id: number;
  wooId: number;
  name: string;
  slug: string;
  parentId: number;
  count: number;
}

interface WooAttribute {
  id: number;
  name: string;
  slug: string;
}

interface AttributeMapping {
  panelKey: string;
  wooAttributeId: number;
  wooAttributeName: string;
  wooAttributeSlug: string;
}

// ─── Client-side WooCommerce fetch ───────────────────────────────────────────

async function wooGet<T>(config: WooConfig, path: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const auth = `consumer_key=${encodeURIComponent(config.key)}&consumer_secret=${encodeURIComponent(config.secret)}`;
  let page = 1;
  const all: unknown[] = [];
  while (true) {
    const url = `${config.url}/wp-json/wc/v3${path}${sep}${auth}&per_page=100&page=${page}`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error(`Respuesta no es JSON (HTTP ${res.status}): ${text.slice(0, 150)}`); }
    if (!Array.isArray(data)) return data as T;
    all.push(...(data as unknown[]));
    if ((data as unknown[]).length < 100) break;
    page++;
  }
  return all as T;
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

type TreeNode = WooCategory & { children: TreeNode[] };

function buildTree(cats: WooCategory[]): TreeNode[] {
  const map = new Map<number, TreeNode>();
  for (const c of cats) map.set(c.wooId, { ...c, children: [] });
  const roots: TreeNode[] = [];
  for (const c of cats) {
    const node = map.get(c.wooId)!;
    if (c.parentId === 0) roots.push(node);
    else map.get(c.parentId)?.children.push(node);
  }
  return roots.sort((a, b) => a.name.localeCompare(b.name));
}

function CategoryNode({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth === 0);
  const has = node.children.length > 0;
  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/40 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 20}px` }}
        onClick={() => has && setOpen((o) => !o)}
      >
        {has
          ? open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <span className="w-3.5 shrink-0" />}
        <span className="text-sm">{node.name}</span>
        <span className="ml-auto text-xs text-muted-foreground">{node.count}</span>
      </div>
      {open && has && node.children.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
        <CategoryNode key={c.wooId} node={c} depth={depth + 1} />
      ))}
    </div>
  );
}

// ─── Attribute keys managed in the panel ─────────────────────────────────────

const PANEL_KEYS = [
  { key: "brand",        label: "Marca" },
  { key: "warranty",     label: "Garantía Oficial" },
  { key: "coolerStock",  label: "Cooler Stock" },
  { key: "iva",          label: "IVA" },
  { key: "socket",       label: "Socket" },
  { key: "memoryType",   label: "Tipo de memoria" },
  { key: "memorySlots",  label: "Slots de memoria" },
  { key: "formFactor",   label: "Factor de forma" },
  { key: "interface",    label: "Interfaz" },
  { key: "capacity",     label: "Capacidad" },
  { key: "tdp",          label: "TDP" },
  { key: "cores",        label: "Núcleos" },
  { key: "gpuIntegrado", label: "Gráficos Integrados" },
  { key: "wattage",      label: "Wattage" },
  { key: "modular",      label: "Modular" },
  { key: "chipset",      label: "Chipset" },
  { key: "vram",         label: "VRAM" },
  { key: "resolution",   label: "Resolución" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WoocommercePage() {
  const configRef = useRef<WooConfig | null>(null);

  const [conn, setConn] = useState<ConnectionState>({ loading: true, connected: false });
  const [categories, setCategories] = useState<WooCategory[]>([]);
  const [catSyncing, setCatSyncing] = useState(false);
  const [catLoading, setCatLoading] = useState(false);

  const [wooAttrs, setWooAttrs] = useState<WooAttribute[]>([]);
  const [mappings, setMappings] = useState<AttributeMapping[]>([]);
  const [attrLoading, setAttrLoading] = useState(false);
  const [attrSaving, setAttrSaving] = useState(false);
  const [attrDirty, setAttrDirty] = useState(false);

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);

  interface PendingProduct { id: number; name: string; sku: string | null; woocommerceId: number }
  const [pendingProducts, setPendingProducts] = useState<PendingProduct[] | null>(null);
  const [pendingProductsLoading, setPendingProductsLoading] = useState(false);

  interface ForceSyncState {
    running: boolean;
    done: boolean;
    total: number;
    processed: number;
    synced: number;
    blocked: number;
    errors: number;
  }
  const [forceSync, setForceSync] = useState<ForceSyncState>({
    running: false, done: false, total: 0, processed: 0, synced: 0, blocked: 0, errors: 0,
  });

  const [serverTest, setServerTest] = useState<ServerTestState>({ loading: false });
  const [bulkImport, setBulkImport] = useState<BulkImportState>({
    running: false, done: false, total: 0, processed: 0, errors: [], onlyPending: true,
  });
  const [importCounts, setImportCounts] = useState<{ total: number; pending: number } | null>(null);

  // 1. Fetch credentials from our API, then test connection from browser
  const checkConnection = useCallback(async () => {
    setConn({ loading: true, connected: false });
    try {
      const cfgRes = await fetch("/api/woocommerce/config");
      const cfg = await cfgRes.json() as WooConfig;
      if (!cfg.configured) {
        setConn({ loading: false, connected: false, error: "Variables de entorno no configuradas" });
        return;
      }
      configRef.current = cfg;

      // Test: single request, no pagination — just verify auth works
      const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;
      const testRes = await fetch(`${cfg.url}/wp-json/wc/v3/products?per_page=1&${auth}`);
      if (!testRes.ok) throw new Error(`HTTP ${testRes.status}`);

      // Get store name from WP REST API (no auth needed, public endpoint)
      let storeName = "WooCommerce";
      try {
        const wpRes = await fetch(`${cfg.url}/wp-json`, { mode: "cors" });
        if (wpRes.ok) {
          const wp = await wpRes.json() as { name?: string };
          if (wp.name) storeName = wp.name;
        }
      } catch {}

      setConn({ loading: false, connected: true, storeName });
    } catch (err) {
      setConn({ loading: false, connected: false, error: String(err) });
    }
  }, []);

  // 2. Load stored categories from our DB
  const loadCategories = useCallback(async () => {
    setCatLoading(true);
    const res = await fetch("/api/woocommerce/categories");
    setCategories(await res.json() as WooCategory[]);
    setCatLoading(false);
  }, []);

  // 3. Sync categories: fetch from WooCommerce (browser) → save to our DB
  const syncCategories = async () => {
    const cfg = configRef.current;
    if (!cfg) return;
    setCatSyncing(true);
    try {
      interface RawCat { id: number; name: string; slug: string; parent: number; count: number }
      const cats = await wooGet<RawCat[]>(cfg, "/products/categories");
      await fetch("/api/woocommerce/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: cats }),
      });
      await loadCategories();
    } catch (err) {
      alert(`Error sincronizando categorías: ${String(err)}`);
    }
    setCatSyncing(false);
  };

  // 4. Load attributes from WooCommerce (browser) + stored mappings from our DB
  const loadAttributes = useCallback(async () => {
    const cfg = configRef.current;
    if (!cfg) return;
    setAttrLoading(true);
    try {
      const [attrs, mappingRes] = await Promise.all([
        wooGet<WooAttribute[]>(cfg, "/products/attributes"),
        fetch("/api/woocommerce/attribute-mappings"),
      ]);
      setWooAttrs(attrs);
      setMappings(await mappingRes.json() as AttributeMapping[]);
    } catch (err) {
      console.error("Error loading attributes:", err);
    }
    setAttrLoading(false);
  }, []);

  useEffect(() => { checkConnection(); }, [checkConnection]);

  useEffect(() => {
    if (conn.connected) {
      loadCategories();
      loadAttributes();
    }
  }, [conn.connected, loadCategories, loadAttributes]);

  // Attribute mapping helpers
  const getMapping = (key: string) => mappings.find((m) => m.panelKey === key);
  const setMapping = (panelKey: string, attr: WooAttribute | null) => {
    setAttrDirty(true);
    setMappings((prev) => {
      const rest = prev.filter((m) => m.panelKey !== panelKey);
      if (!attr) return rest;
      return [...rest, { panelKey, wooAttributeId: attr.id, wooAttributeName: attr.name, wooAttributeSlug: attr.slug }];
    });
  };

  const saveMappings = async () => {
    setAttrSaving(true);
    await fetch("/api/woocommerce/attribute-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappings }),
    });
    setAttrDirty(false);
    setAttrSaving(false);
  };

  const loadSyncStatus = useCallback(async () => {
    setSyncStatusLoading(true);
    const res = await fetch("/api/woocommerce/sync-status");
    if (res.ok) setSyncStatus(await res.json() as SyncStatus);
    setSyncStatusLoading(false);
  }, []);

  const loadPendingProducts = useCallback(async () => {
    setPendingProductsLoading(true);
    const res = await fetch("/api/woocommerce/pending-products");
    if (res.ok) setPendingProducts(await res.json() as PendingProduct[]);
    setPendingProductsLoading(false);
  }, []);

  const handleForceSyncAll = async () => {
    if (!confirm(`¿Confirmar? Se van a sincronizar todos los productos vinculados a WooCommerce ahora mismo. Los safeguards siguen activos (productos sin precio o con bajada >10% van a revisión).`)) return;

    // 1. Mark all WC-linked products as pending
    const markRes = await fetch("/api/woocommerce/force-sync-all", { method: "POST" });
    if (!markRes.ok) { alert("Error al iniciar sincronización"); return; }
    const { queued } = await markRes.json() as { queued: number };

    setForceSync({ running: true, done: false, total: queued, processed: 0, synced: 0, blocked: 0, errors: 0 });

    // 2. Process in chunks via run-sync.
    // Stop when we've resolved >= initialQueued products (don't rely on hasMore alone —
    // the cron could re-add products during the run, causing an infinite UI loop).
    let totalSynced = 0, totalBlocked = 0, totalErrors = 0, totalResolved = 0;
    let consecutiveEmpty = 0;

    while (totalResolved < queued) {
      try {
        const res = await fetch("/api/woocommerce/run-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 100 }),
        });
        if (!res.ok) break;
        const data = await res.json() as {
          synced: number; blocked: number; errors: number; processed: number;
          clearedThisCall: number; hasMore: boolean;
        };
        totalSynced += data.synced;
        totalBlocked += data.blocked;
        totalErrors += data.errors;
        totalResolved += data.clearedThisCall; // only count fully resolved (not errors that stay pending)
        setForceSync((prev) => ({
          ...prev,
          processed: Math.min(totalResolved + totalErrors, queued),
          synced: totalSynced,
          blocked: totalBlocked,
          errors: totalErrors,
        }));
        if (!data.hasMore) break;
        // Guard: if nothing was resolved in this call, don't loop forever.
        // Use a high threshold (10) so temporary WC timeouts don't abort a large sync.
        if (data.clearedThisCall === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 10) break;
        } else {
          consecutiveEmpty = 0;
        }
        // Small pause between batches to avoid overwhelming WC
        await new Promise((r) => setTimeout(r, 500));
      } catch {
        break;
      }
    }

    setForceSync((prev) => ({ ...prev, running: false, done: true }));
    await loadSyncStatus();
  };

  const loadImportCounts = useCallback(async () => {
    const res = await fetch("/api/woocommerce/bulk-import");
    if (res.ok) setImportCounts(await res.json() as { total: number; pending: number });
  }, []);

  useEffect(() => { loadImportCounts(); loadSyncStatus(); }, [loadImportCounts, loadSyncStatus]);

  const testServerConnection = async () => {
    setServerTest({ loading: true });
    try {
      const res = await fetch("/api/woocommerce/test-connection");
      const { loading: _l, ...data } = await res.json() as ServerTestState & { ok: boolean };
      void _l;
      setServerTest({ loading: false, ...data });
    } catch (err) {
      setServerTest({ loading: false, ok: false, error: String(err) });
    }
  };

  const runBulkImport = async (onlyPending: boolean) => {
    setBulkImport({ running: true, done: false, total: 0, processed: 0, errors: [], onlyPending });

    let offset = 0;
    let allErrors: BulkImportState["errors"] = [];

    while (true) {
      const res = await fetch("/api/woocommerce/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset, limit: 30, onlyPending }),
      });
      const data = await res.json() as {
        processed: number; total: number; errors: BulkImportState["errors"]; nextOffset: number | null;
      };

      allErrors = [...allErrors, ...data.errors];
      setBulkImport((prev) => ({
        ...prev,
        processed: offset + data.processed,
        total: data.total,
        errors: allErrors,
      }));

      if (data.nextOffset === null) break;
      offset = data.nextOffset;
    }

    setBulkImport((prev) => ({ ...prev, running: false, done: true }));
    // Refresh counts after import
    loadImportCounts();
  };

  const tree = buildTree(categories);

  return (
    <div className="space-y-6">
      <PageHeader
        title="WooCommerce"
        breadcrumbs={[{ label: "WooCommerce" }, { label: "Configuración" }]}
        description="Conectá y sincronizá tu tienda WooCommerce con el panel"
      />

      {/* Sync status + force sync */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Estado de sincronización automática</CardTitle>
                <CardDescription className="text-xs">
                  El cron detecta cambios de precio y stock cada 15 min y actualiza WooCommerce
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadSyncStatus} disabled={syncStatusLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${syncStatusLoading ? "animate-spin" : ""}`} />
              Actualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {syncStatus ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Vinculados a WC</p>
                <p className="text-xl font-bold">{syncStatus.total}</p>
              </div>
              <div className={`rounded-lg border px-3 py-2 ${syncStatus.pending > 0 ? "bg-orange-50 border-orange-200 dark:bg-orange-950/20" : "bg-muted/30"}`}>
                <p className="text-xs text-muted-foreground">Pendientes de sync</p>
                <p className={`text-xl font-bold ${syncStatus.pending > 0 ? "text-orange-600" : ""}`}>{syncStatus.pending}</p>
              </div>
              <div className={`rounded-lg border px-3 py-2 ${syncStatus.neverSynced > 0 ? "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20" : "bg-muted/30"}`}>
                <p className="text-xs text-muted-foreground">Nunca sincronizados</p>
                <p className={`text-xl font-bold ${syncStatus.neverSynced > 0 ? "text-yellow-600" : ""}`}>{syncStatus.neverSynced}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">Último sync exitoso</p>
                <p className="text-sm font-medium">
                  {syncStatus.lastSyncedAt
                    ? new Date(syncStatus.lastSyncedAt).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </p>
              </div>
            </div>
          ) : (
            <div className="h-16 rounded-lg bg-muted/30 animate-pulse" />
          )}

          {/* Pending products detail — only show when there are pending items */}
          {syncStatus && syncStatus.pending > 0 && syncStatus.pending <= 50 && (
            <div className="border rounded-md bg-orange-50/50 dark:bg-orange-950/10 border-orange-200 dark:border-orange-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-orange-700 dark:text-orange-400">
                  {syncStatus.pending} producto{syncStatus.pending !== 1 ? "s" : ""} pendiente{syncStatus.pending !== 1 ? "s" : ""} de sync
                </p>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={loadPendingProducts} disabled={pendingProductsLoading}>
                  {pendingProductsLoading ? "Cargando..." : pendingProducts ? "Actualizar" : "Ver cuáles son"}
                </Button>
              </div>
              {pendingProducts && (
                <div className="space-y-1">
                  {pendingProducts.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground w-12 shrink-0">#{p.woocommerceId}</span>
                      <span className="flex-1 truncate">{p.name}</span>
                      {p.sku && <span className="text-muted-foreground shrink-0">{p.sku}</span>}
                      <a
                        href={`/products/${p.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-primary hover:underline flex items-center gap-0.5"
                      >
                        Ver <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground pt-1">
                    Abrí el producto → Sync manual para ver el error exacto.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong>Sincronización forzada:</strong> actualiza todos los productos en WooCommerce ahora mismo.
                Usa la API batch de WC (100 productos por llamada HTTP). Los safeguards siguen activos.
              </p>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={handleForceSyncAll}
                disabled={forceSync.running || !syncStatus || syncStatus.total === 0}
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
              >
                <Zap className={`h-4 w-4 mr-2 ${forceSync.running ? "animate-pulse" : ""}`} />
                {forceSync.running ? "Sincronizando..." : "Forzar sync completo"}
              </Button>
              {!forceSync.running && !forceSync.done && syncStatus && syncStatus.total > 0 && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  ~{Math.ceil(syncStatus.total / 100 * 3 / 60)} min estimados para {syncStatus.total.toLocaleString()} productos
                </span>
              )}
            </div>

            {(forceSync.running || forceSync.done) && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {forceSync.processed.toLocaleString()} / {forceSync.total.toLocaleString()} procesados
                    {forceSync.running && forceSync.processed > 0 && (
                      <span className="ml-2 text-muted-foreground/70">
                        · ~{Math.ceil((forceSync.total - forceSync.processed) / 100 * 3 / 60)} min restantes
                      </span>
                    )}
                  </span>
                  <span>{forceSync.total > 0 ? Math.round((forceSync.processed / forceSync.total) * 100) : 0}%</span>
                </div>
                <Progress value={forceSync.total > 0 ? (forceSync.processed / forceSync.total) * 100 : 0} />
                <div className="flex gap-4 text-xs flex-wrap">
                  <span className="text-green-600">✓ {forceSync.synced.toLocaleString()} sincronizados</span>
                  {forceSync.blocked > 0 && (
                    <span className="text-yellow-600">⚠ {forceSync.blocked} bloqueados (revisión)</span>
                  )}
                  {forceSync.errors > 0 && (
                    <span className="text-orange-600">↻ {forceSync.errors} con error (se reintentarán por el cron)</span>
                  )}
                </div>
                {forceSync.done && (
                  <div className="flex items-center gap-1.5 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      Sync completo — {forceSync.synced.toLocaleString()} actualizados
                      {forceSync.blocked > 0 && `, ${forceSync.blocked} para revisar`}
                      {forceSync.errors > 0 && `, ${forceSync.errors} errores (el cron los reintentará)`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Connection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Conexión</CardTitle>
            </div>
            <Button variant="outline" size="sm" onClick={checkConnection} disabled={conn.loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${conn.loading ? "animate-spin" : ""}`} />
              Verificar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {conn.loading ? (
            <p className="text-sm text-muted-foreground">Verificando conexión...</p>
          ) : (
            <div className="flex items-center gap-3">
              {conn.connected
                ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                : <XCircle className="h-5 w-5 text-destructive shrink-0" />}
              <div>
                <p className="text-sm font-medium">
                  {conn.connected
                    ? `Conectado — ${conn.storeName}`
                    : "Credenciales configuradas pero no se pudo conectar"}
                </p>
                {configRef.current?.url && (
                  <p className="text-xs text-muted-foreground">{configRef.current.url}</p>
                )}
                {conn.error && <p className="text-xs text-destructive mt-1">{conn.error}</p>}
              </div>
              {conn.connected && (
                <Badge variant="outline" className="ml-auto text-green-600 border-green-300">Online</Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Server-to-server connectivity test */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Conexión servidor → WooCommerce</CardTitle>
                <CardDescription className="text-xs">
                  Verifica que Railway pueda conectarse directamente a WooCommerce (necesario para auto-sync)
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={testServerConnection} disabled={serverTest.loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${serverTest.loading ? "animate-spin" : ""}`} />
              Probar
            </Button>
          </div>
        </CardHeader>
        {!serverTest.loading && serverTest.ok !== undefined && (
          <CardContent>
            <div className="flex items-start gap-3">
              {serverTest.ok
                ? <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                : <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />}
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {serverTest.ok ? "Conexión exitosa desde el servidor" : "Error de conexión servidor"}
                </p>
                {serverTest.ok && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    {serverTest.latencyMs !== undefined && <p>Latencia: <strong>{serverTest.latencyMs} ms</strong></p>}
                    {serverTest.serverIp && <p>IP del servidor: <strong>{serverTest.serverIp}</strong></p>}
                    {serverTest.productCount !== undefined && serverTest.productCount !== null && (
                      <p>Productos visibles: <strong>{serverTest.productCount}</strong></p>
                    )}
                  </div>
                )}
                {!serverTest.ok && serverTest.serverIp && (
                  <p className="text-xs text-muted-foreground">IP del servidor: <strong>{serverTest.serverIp}</strong></p>
                )}
                {serverTest.error && <p className="text-xs text-destructive">{serverTest.error}</p>}
                {serverTest.body && (
                  <pre className="text-xs text-muted-foreground bg-muted rounded p-2 mt-1 max-h-20 overflow-auto whitespace-pre-wrap">{serverTest.body}</pre>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Bulk import */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5 text-primary" />
              <div>
                <CardTitle className="text-base">Importación masiva desde WooCommerce</CardTitle>
                <CardDescription className="text-xs">
                  Trae categorías, atributos, marca, garantía e imágenes para todos los productos con WooCommerce ID
                  {importCounts && (
                    <span className="ml-1">
                      — <strong>{importCounts.pending}</strong> pendientes de <strong>{importCounts.total}</strong> total
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {importCounts && importCounts.pending < importCounts.total && !bulkImport.running && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => runBulkImport(false)}
                  className="text-xs text-muted-foreground"
                >
                  Re-importar todo
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => runBulkImport(true)}
                disabled={bulkImport.running || (importCounts?.pending === 0 && !bulkImport.done)}
              >
                <Download className={`h-4 w-4 mr-2 ${bulkImport.running ? "animate-pulse" : ""}`} />
                {bulkImport.running
                  ? "Importando..."
                  : importCounts?.pending === 0
                  ? "Todo importado ✓"
                  : `Importar pendientes${importCounts ? ` (${importCounts.pending})` : ""}`}
              </Button>
            </div>
          </div>
        </CardHeader>
        {(bulkImport.running || bulkImport.done) && (
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{bulkImport.processed} / {bulkImport.total} {bulkImport.onlyPending ? "pendientes" : "productos"}</span>
                <span>{bulkImport.total > 0 ? Math.round((bulkImport.processed / bulkImport.total) * 100) : 0}%</span>
              </div>
              <Progress value={bulkImport.total > 0 ? (bulkImport.processed / bulkImport.total) * 100 : 0} />
            </div>
            {bulkImport.done && (
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-green-600">
                  Importación completa — {bulkImport.processed} productos actualizados
                  {bulkImport.errors.length > 0 && `, ${bulkImport.errors.length} errores`}
                </span>
              </div>
            )}
            {bulkImport.errors.length > 0 && (
              <div className="rounded-md bg-destructive/10 p-3 space-y-1 max-h-40 overflow-y-auto">
                <p className="text-xs font-medium text-destructive">Errores:</p>
                {bulkImport.errors.map((e) => (
                  <p key={e.id} className="text-xs text-destructive">{e.name}: {e.error}</p>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {conn.connected && (
        <>
          {/* Categories */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Tag className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Categorías</CardTitle>
                    <CardDescription className="text-xs">
                      {categories.length > 0
                        ? `${categories.length} categorías sincronizadas desde WooCommerce`
                        : "Aún no sincronizadas"}
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={syncCategories} disabled={catSyncing}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${catSyncing ? "animate-spin" : ""}`} />
                  {categories.length === 0 ? "Sincronizar" : "Re-sincronizar"}
                </Button>
              </div>
            </CardHeader>
            {catLoading ? (
              <CardContent><p className="text-sm text-muted-foreground">Cargando...</p></CardContent>
            ) : categories.length > 0 ? (
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Estas son las categorías de tu WooCommerce. Las podés asignar a productos desde el panel.
                </p>
                <div className="rounded-md border bg-muted/20 p-2 max-h-96 overflow-y-auto">
                  {tree.map((node) => <CategoryNode key={node.wooId} node={node} />)}
                </div>
              </CardContent>
            ) : null}
          </Card>

          {/* Attributes */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-5 w-5 text-primary" />
                  <div>
                    <CardTitle className="text-base">Atributos</CardTitle>
                    <CardDescription className="text-xs">
                      Mapeá las claves del panel a los atributos de WooCommerce
                    </CardDescription>
                  </div>
                </div>
                {attrDirty && (
                  <Button size="sm" onClick={saveMappings} disabled={attrSaving}>
                    {attrSaving ? "Guardando..." : "Guardar cambios"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {attrLoading ? (
                <p className="text-sm text-muted-foreground">Cargando atributos...</p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-4">
                    Asociá cada campo del panel con el atributo correspondiente en WooCommerce.
                    Dejá &quot;Sin mapear&quot; los que no querés sincronizar.
                  </p>
                  <div className="space-y-2">
                    {PANEL_KEYS.map(({ key, label }) => {
                      const current = getMapping(key);
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-40 text-sm shrink-0">{label}</span>
                          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded w-32 shrink-0">{key}</code>
                          <select
                            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-sm"
                            value={current?.wooAttributeId ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setMapping(key, val ? wooAttrs.find((a) => a.id === Number(val)) ?? null : null);
                            }}
                          >
                            <option value="">Sin mapear</option>
                            {wooAttrs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                          {current && <Badge variant="outline" className="text-xs shrink-0">Mapeado</Badge>}
                        </div>
                      );
                    })}
                  </div>
                  {wooAttrs.length === 0 && (
                    <p className="text-sm text-muted-foreground">No se encontraron atributos en WooCommerce.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
