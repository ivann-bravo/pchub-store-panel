"use client";

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, RefreshCw, Loader2, Zap, Clock } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface SyncLogEntry {
  id: number;
  panel_id: number | null;
  woo_id: number;
  product_name: string;
  regular_price: number | null;
  offer_price: number | null;
  stock_qty: number | null;
  prev_regular_price: number | null;
  prev_offer_price: number | null;
  prev_stock_qty: number | null;
  synced_at: string;
}

interface PendingProduct {
  id: number;
  name: string;
  sku: string | null;
  woocommerceId: number | null;
  wooSyncedRegularPrice: number | null;
  wooSyncedStockQty: number | null;
  wooLastSyncedAt: string | null;
  wooManualPrivate: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatPrice(val: number | null): string {
  if (val == null) return "—";
  return `$${Math.round(val).toLocaleString("es-AR")}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

type ChangeType = "precio" | "stock" | "precio+stock" | "nuevo";

function getChange(entry: SyncLogEntry): { type: ChangeType; before: string; after: string } {
  const hasPrev = entry.prev_regular_price !== null || entry.prev_stock_qty !== null;
  if (!hasPrev) {
    return { type: "nuevo", before: "—", after: formatPrice(entry.regular_price) };
  }
  const priceChanged = Math.round(entry.regular_price ?? 0) !== Math.round(entry.prev_regular_price ?? 0);
  const stockChanged = (entry.stock_qty ?? 0) !== (entry.prev_stock_qty ?? 0);

  if (priceChanged && stockChanged) {
    return {
      type: "precio+stock",
      before: formatPrice(entry.prev_regular_price),
      after: formatPrice(entry.regular_price),
    };
  }
  if (priceChanged) {
    return {
      type: "precio",
      before: formatPrice(entry.prev_regular_price),
      after: formatPrice(entry.regular_price),
    };
  }
  if (stockChanged) {
    return {
      type: "stock",
      before: String(entry.prev_stock_qty ?? 0),
      after: String(entry.stock_qty ?? 0),
    };
  }
  // values identical (safeguard was lifted, status changed, etc.)
  return { type: "precio", before: formatPrice(entry.prev_regular_price), after: formatPrice(entry.regular_price) };
}

const CHANGE_BADGE: Record<ChangeType, string> = {
  "precio":       "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "stock":        "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  "precio+stock": "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "nuevo":        "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

// ── Component ──────────────────────────────────────────────────────────────────

export default function SyncLogPage() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <p className="text-sm">Esta función no está disponible en la demo.</p>
      </div>
    );
  }
  return <SyncLogPageInner />;
}

function SyncLogPageInner() {
  // History state
  const [items, setItems]     = useState<SyncLogEntry[]>([]);
  const [total, setTotal]     = useState(0);
  const [pages, setPages]     = useState(1);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [date, setDate]       = useState("7d");
  const [changeType, setChangeType] = useState("all");
  const [loading, setLoading] = useState(true);

  // Pending queue state
  const [pendingTotal, setPendingTotal]   = useState<number | null>(null);
  const [pendingItems, setPendingItems]   = useState<PendingProduct[]>([]);
  const [pendingOpen, setPendingOpen]     = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [syncProgress, setSyncProgress]   = useState<string | null>(null);

  // ── Fetch log ──────────────────────────────────────────────────────────────

  const fetchLog = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: "50",
        ...(search && { product: search }),
        date,
        ...(changeType !== "all" && { change_type: changeType }),
      });
      const res  = await fetch(`/api/woocommerce/sync-log?${params}`);
      const data = await res.json();
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPages(data.pages ?? 1);
    } finally {
      setLoading(false);
    }
  }, [page, search, date, changeType]);

  useEffect(() => { fetchLog(); }, [fetchLog]);

  // ── Fetch pending queue ────────────────────────────────────────────────────

  const fetchPending = useCallback(async () => {
    const res  = await fetch("/api/woocommerce/pending-products");
    const data = await res.json();
    setPendingTotal(data.total ?? 0);
    setPendingItems(data.items ?? []);
  }, []);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // ── Manual sync ───────────────────────────────────────────────────────────

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress(null);
    try {
      let remaining = pendingTotal ?? 0;
      let totalSynced = 0;
      while (remaining > 0) {
        const res  = await fetch("/api/woocommerce/run-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
        const data = await res.json();
        totalSynced += (data.synced ?? 0);
        remaining    = data.remaining ?? 0;
        setSyncProgress(`Sincronizados: ${totalSynced} · Restantes: ${remaining}`);
        if (!data.hasMore) break;
      }
      await fetchPending();
      await fetchLog();
    } finally {
      setSyncing(false);
    }
  };

  // ── Filters ────────────────────────────────────────────────────────────────

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { setSearch(draftSearch); setPage(1); }
  };
  const handleFilterChange = (setter: (v: string) => void) => (val: string) => {
    setter(val); setPage(1);
  };

  const dateLabel: Record<string, string> = { "7d": "Últimos 7 días", today: "Hoy", yesterday: "Ayer" };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Historial de Sync WooCommerce"
        description={`${dateLabel[date]} · ${total.toLocaleString("es-AR")} registros`}
        actions={
          <Button variant="outline" size="sm" onClick={() => { fetchLog(); fetchPending(); }} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      {/* ── Cola pendiente ───────────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Cola pendiente</span>
            {pendingTotal !== null && (
              <Badge variant={pendingTotal > 0 ? "warning" : "success"} className="text-xs">
                {pendingTotal.toLocaleString("es-AR")} producto{pendingTotal !== 1 ? "s" : ""}
              </Badge>
            )}
            {syncProgress && (
              <span className="text-xs text-muted-foreground">{syncProgress}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {pendingTotal !== null && pendingTotal > 0 && (
              <Button size="sm" onClick={handleSync} disabled={syncing}>
                {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Zap className="h-4 w-4 mr-2" />}
                {syncing ? "Sincronizando..." : "Sincronizar ahora"}
              </Button>
            )}
            {pendingItems.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setPendingOpen((o) => !o)}>
                {pendingOpen ? "Ocultar" : "Ver cola"}
              </Button>
            )}
          </div>
        </div>

        {pendingOpen && pendingItems.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="w-[140px]">Precio sync</TableHead>
                  <TableHead className="w-[100px]">Stock sync</TableHead>
                  <TableHead className="w-[140px]">Último sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingItems.map((p) => (
                  <TableRow key={p.id} className="even:bg-muted/30">
                    <TableCell className="font-medium">
                      <a href={`/products/${p.id}`} className="hover:underline">
                        {p.name}
                      </a>
                      {p.wooManualPrivate && (
                        <Badge variant="secondary" className="ml-2 text-xs">Pausado</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-2">#{p.woocommerceId}</span>
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {formatPrice(p.wooSyncedRegularPrice)}
                    </TableCell>
                    <TableCell className="tabular-nums text-sm">
                      {p.wooSyncedStockQty ?? 0}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(p.wooLastSyncedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pendingTotal !== null && pendingTotal > pendingItems.length && (
              <p className="text-xs text-muted-foreground px-4 py-2">
                Mostrando {pendingItems.length} de {pendingTotal.toLocaleString("es-AR")} pendientes
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar producto..."
          className="h-8 text-sm w-56"
          value={draftSearch}
          onChange={(e) => setDraftSearch(e.target.value)}
          onKeyDown={handleSearchKeyDown}
        />
        <Select value={date} onValueChange={handleFilterChange(setDate)}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="today">Hoy</SelectItem>
            <SelectItem value="yesterday">Ayer</SelectItem>
          </SelectContent>
        </Select>
        <Select value={changeType} onValueChange={handleFilterChange(setChangeType)}>
          <SelectTrigger className="w-44 h-8 text-sm">
            <SelectValue placeholder="Tipo de cambio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los cambios</SelectItem>
            <SelectItem value="price">Solo precio</SelectItem>
            <SelectItem value="stock">Solo stock</SelectItem>
          </SelectContent>
        </Select>
        {(search || draftSearch) && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSearch(""); setDraftSearch(""); setPage(1); }}>
            Limpiar
          </Button>
        )}
      </div>

      {/* ── Tabla historial ──────────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="w-[110px]">Cambio</TableHead>
              <TableHead className="w-[120px]">Antes</TableHead>
              <TableHead className="w-[120px]">Ahora</TableHead>
              <TableHead className="w-[140px]">Sincronizado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  Cargando...
                </TableCell>
              </TableRow>
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  Sin registros
                </TableCell>
              </TableRow>
            ) : items.map((entry) => {
              const change = getChange(entry);
              return (
                <TableRow key={entry.id} className="even:bg-muted/30">
                  <TableCell className="font-medium">
                    {entry.panel_id ? (
                      <a href={`/products/${entry.panel_id}`} className="hover:underline text-foreground">
                        {entry.product_name}
                      </a>
                    ) : (
                      <span>{entry.product_name}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">#{entry.woo_id}</span>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${CHANGE_BADGE[change.type]}`}>
                      {change.type}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums text-sm text-muted-foreground">
                    {change.before}
                  </TableCell>
                  <TableCell className="tabular-nums text-sm font-medium">
                    {change.after}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(entry.synced_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ── Paginación ───────────────────────────────────────────────────── */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
