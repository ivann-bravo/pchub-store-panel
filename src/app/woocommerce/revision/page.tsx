"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ShieldAlert,
  CheckCircle,
  XCircle,
  ExternalLink,
  AlertTriangle,
  Loader2,
  CheckCheck,
} from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";

type Status = "pending" | "approved" | "rejected";

interface BlockedItem {
  id: number;
  productId: number;
  wooId: number;
  productName: string;
  reason: string;
  newPrice: number | null;
  oldPrice: number | null;
  payload: string;
  status: Status;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

const STATUS_LABELS: Record<Status, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
};

export default function WooRevisionPage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<Status>("pending");
  const [items, setItems] = useState<BlockedItem[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);

  // Risk confirmation dialog (replaces window.confirm)
  const [riskDialog, setRiskDialog] = useState<{
    item: BlockedItem;
    reason: string;
    onConfirm: () => void;
  } | null>(null);

  const fetchItems = useCallback(async (status: Status) => {
    setLoading(true);
    setSelected(new Set());
    try {
      const res = await fetch(`/api/woocommerce/sync-blocked?status=${status}&limit=50`);
      const data = await res.json() as { items: BlockedItem[]; total: number; pendingCount: number };
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setPendingCount(data.pendingCount ?? 0);
    } catch {
      toast.error("Error cargando lista");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(tab); }, [tab, fetchItems]);

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map(i => i.id)));
  };

  const handleReject = async (item: BlockedItem) => {
    setActionLoading(item.id);
    try {
      const res = await fetch(`/api/woocommerce/sync-blocked/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reviewedBy: session?.user?.email ?? "" }),
      });
      if (!res.ok) throw new Error();
      toast.success("Sync rechazado");
      fetchItems(tab);
    } catch {
      toast.error("Error al rechazar");
    } finally {
      setActionLoading(null);
    }
  };

  // Core approve logic — extracted so it can be reused by single + bulk flows
  const doApprove = async (
    item: BlockedItem,
    skipRiskCheck = false,
  ): Promise<"ok" | "blocked" | "error"> => {
    try {
      const [payloadRes, cfgRes] = await Promise.all([
        fetch(`/api/woocommerce/sync-payload/${item.productId}`),
        fetch("/api/woocommerce/config"),
      ]);

      let payloadData: Record<string, unknown>;
      let wooId: number;

      if (payloadRes.ok) {
        const fresh = await payloadRes.json() as {
          wooId: number;
          data: Record<string, unknown>;
          safeguard: { blocked: boolean; reason?: string };
        };
        wooId = fresh.wooId;
        payloadData = fresh.data;
        if (fresh.safeguard.blocked && !skipRiskCheck) return "blocked";
      } else {
        const stored = JSON.parse(item.payload) as { wooId: number; data: Record<string, unknown> };
        wooId = stored.wooId;
        payloadData = stored.data;
      }

      const cfg = await cfgRes.json() as { url: string; key: string; secret: string };
      const auth = `consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`;

      // Preserve existing WC attributes, replace IVA
      const currentRes = await fetch(`${cfg.url}/wp-json/wc/v3/products/${wooId}?${auth}`);
      if (currentRes.ok) {
        const current = await currentRes.json() as {
          attributes?: { id: number; name: string; options: string[]; visible: boolean; variation: boolean; position: number }[];
        };
        const ivaAttr = (payloadData.attributes as { id: number }[] | undefined)?.[0];
        if (ivaAttr && Array.isArray(current.attributes)) {
          const others = current.attributes.filter((a) => a.id !== ivaAttr.id);
          payloadData.attributes = [...others, ivaAttr];
        }
      }

      const wcRes = await fetch(`${cfg.url}/wp-json/wc/v3/products/batch?${auth}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ update: [{ id: wooId, ...payloadData }] }),
      });
      if (!wcRes.ok) {
        const err = await wcRes.text();
        throw new Error(`WooCommerce: ${err.slice(0, 200)}`);
      }

      await fetch(`/api/woocommerce/sync-blocked/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", reviewedBy: session?.user?.email ?? "" }),
      });

      const regularPriceNum = parseFloat((payloadData.regular_price as string) ?? "0");
      if (regularPriceNum > 0) {
        await fetch(`/api/woocommerce/sync-confirmed/${item.productId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ regularPrice: regularPriceNum }),
        });
      }

      return "ok";
    } catch {
      return "error";
    }
  };

  const handleApprove = async (item: BlockedItem) => {
    setActionLoading(item.id);
    try {
      const result = await doApprove(item);
      if (result === "blocked") {
        // Fetch reason for the dialog
        const payloadRes = await fetch(`/api/woocommerce/sync-payload/${item.productId}`);
        const fresh = await payloadRes.json() as { safeguard: { reason?: string } };
        setRiskDialog({
          item,
          reason: fresh.safeguard.reason ?? "El sync es considerado riesgoso",
          onConfirm: async () => {
            setRiskDialog(null);
            setActionLoading(item.id);
            const r = await doApprove(item, true);
            if (r === "ok") {
              toast.success("Sync aprobado y sincronizado con WooCommerce");
              fetchItems(tab);
            } else {
              toast.error("Error al aprobar el sync");
            }
            setActionLoading(null);
          },
        });
        return;
      }
      if (result === "ok") {
        toast.success("Sync aprobado y sincronizado");
        fetchItems(tab);
      } else {
        toast.error("Error al aprobar");
      }
    } finally {
      if (!riskDialog) setActionLoading(null);
    }
  };

  const handleBulkReject = async () => {
    const itemsToReject = items.filter(i => selected.has(i.id));
    let rejected = 0;
    for (const item of itemsToReject) {
      try {
        await fetch(`/api/woocommerce/sync-blocked/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", reviewedBy: session?.user?.email ?? "" }),
        });
        rejected++;
      } catch {}
    }
    toast.success(`${rejected} sync${rejected !== 1 ? "s" : ""} rechazado${rejected !== 1 ? "s" : ""}`);
    fetchItems(tab);
  };

  const handleBulkApprove = async () => {
    const itemsToApprove = items.filter(i => selected.has(i.id));
    setBulkProgress({ current: 0, total: itemsToApprove.length });
    let ok = 0, errors = 0;
    for (let i = 0; i < itemsToApprove.length; i++) {
      setBulkProgress({ current: i + 1, total: itemsToApprove.length });
      const result = await doApprove(itemsToApprove[i]);
      if (result === "ok") ok++;
      else if (result === "blocked") {
        toast.warning(`"${itemsToApprove[i].productName.substring(0, 30)}..." omitido — sigue siendo riesgoso`);
      } else {
        errors++;
      }
    }
    setBulkProgress(null);
    if (ok > 0) toast.success(`${ok} sync${ok !== 1 ? "s" : ""} aprobado${ok !== 1 ? "s" : ""}`);
    if (errors > 0) toast.error(`${errors} error${errors !== 1 ? "es" : ""} al sincronizar`);
    fetchItems(tab);
  };

  const handleRejectAll = async () => {
    let rejected = 0;
    for (const item of items) {
      try {
        await fetch(`/api/woocommerce/sync-blocked/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reject", reviewedBy: session?.user?.email ?? "" }),
        });
        rejected++;
      } catch {}
    }
    toast.success(`${rejected} sync${rejected !== 1 ? "s" : ""} rechazado${rejected !== 1 ? "s" : ""}`);
    fetchItems(tab);
  };

  const isBusy = actionLoading !== null || bulkProgress !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Syncs Bloqueados"
        breadcrumbs={[{ label: "WooCommerce" }, { label: "Syncs Bloqueados" }]}
        description="Revisá y aprobá o rechazá cada sync bloqueado por el sistema de seguridad"
      />

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(["pending", "approved", "rejected"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === s
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {STATUS_LABELS[s]}
            {s === "pending" && pendingCount > 0 && (
              <Badge variant="destructive" className="ml-2 text-xs">{pendingCount}</Badge>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {tab === "pending" && !loading && items.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap min-h-[36px]">
          <span className="text-sm text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} seleccionado${selected.size !== 1 ? "s" : ""}`
              : `${total} pendiente${total !== 1 ? "s" : ""}`}
          </span>

          {selected.size > 0 ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkApprove}
                disabled={isBusy}
                className="text-green-600 border-green-300 hover:bg-green-50"
              >
                {bulkProgress ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Aprobando {bulkProgress.current}/{bulkProgress.total}...
                  </>
                ) : (
                  <>
                    <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                    Aprobar {selected.size}
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkReject}
                disabled={isBusy}
                className="text-red-600 border-red-300 hover:bg-red-50"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Rechazar {selected.size}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(new Set())}
                disabled={isBusy}
                className="text-muted-foreground"
              >
                Cancelar selección
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRejectAll}
              disabled={isBusy}
              className="text-red-600 border-red-300 hover:bg-red-50"
            >
              <XCircle className="h-3.5 w-3.5 mr-1.5" />
              Rechazar todos
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-3">
              {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={tab === "pending" ? CheckCircle : ShieldAlert}
              title={
                tab === "pending"
                  ? "Todo al día"
                  : `Sin syncs ${tab === "approved" ? "aprobados" : "rechazados"}`
              }
              description={
                tab === "pending"
                  ? "No hay syncs pendientes de revisión"
                  : "No hay registros en esta categoría"
              }
            />
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    {tab === "pending" && (
                      <TableHead className="w-[44px]">
                        <input
                          type="checkbox"
                          checked={items.length > 0 && selected.size === items.length}
                          onChange={toggleSelectAll}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </TableHead>
                    )}
                    <TableHead>Producto</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Anterior</TableHead>
                    <TableHead className="text-right">Nuevo</TableHead>
                    <TableHead className="text-right">Cambio</TableHead>
                    <TableHead className="text-right">Fecha</TableHead>
                    {tab === "pending" && <TableHead className="w-[160px]" />}
                    {tab !== "pending" && <TableHead className="text-right">Revisado por</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const pctRaw = item.oldPrice && item.newPrice
                      ? Math.round((item.newPrice / item.oldPrice - 1) * 100)
                      : null;
                    const isItemLoading = actionLoading === item.id;

                    return (
                      <TableRow
                        key={item.id}
                        className={selected.has(item.id) ? "bg-muted/40" : undefined}
                      >
                        {tab === "pending" && (
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </TableCell>
                        )}
                        <TableCell className="max-w-[180px]">
                          <Link
                            href={`/products/${item.productId}`}
                            className="text-primary hover:underline font-medium flex items-center gap-1"
                          >
                            <span className="truncate">{item.productName}</span>
                            <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-[240px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm text-muted-foreground cursor-help line-clamp-2 block">
                                {item.reason}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-sm text-xs">
                              {item.reason}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {item.oldPrice ? formatARS(item.oldPrice) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {item.newPrice ? formatARS(item.newPrice) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm font-medium">
                          {pctRaw != null ? (
                            <span className={pctRaw < 0 ? "text-red-600" : "text-green-600"}>
                              {pctRaw > 0 ? "+" : ""}{pctRaw}%
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(item.createdAt).toLocaleString("es-AR", {
                            timeZone: "America/Argentina/Buenos_Aires",
                            day: "2-digit", month: "2-digit",
                            hour: "2-digit", minute: "2-digit", hour12: false,
                          })}
                        </TableCell>
                        {tab === "pending" && (
                          <TableCell>
                            <div className="flex gap-1.5 justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => handleApprove(item)}
                                className="text-green-600 border-green-200 hover:bg-green-50 h-7 px-2.5"
                              >
                                {isItemLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <CheckCircle className="h-3 w-3" />
                                )}
                                <span className="ml-1 text-xs">Aprobar</span>
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isBusy}
                                onClick={() => handleReject(item)}
                                className="text-red-600 border-red-200 hover:bg-red-50 h-7 px-2.5"
                              >
                                {isItemLoading ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <XCircle className="h-3 w-3" />
                                )}
                                <span className="ml-1 text-xs">Rechazar</span>
                              </Button>
                            </div>
                          </TableCell>
                        )}
                        {tab !== "pending" && (
                          <TableCell className="text-right text-xs text-muted-foreground">
                            <div>{item.reviewedBy ?? "—"}</div>
                            {item.reviewedAt && (
                              <div className="opacity-70">
                                {new Date(item.reviewedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                              </div>
                            )}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>

      {/* Risk confirmation dialog — replaces window.confirm() */}
      <Dialog open={riskDialog !== null} onOpenChange={(open) => { if (!open) { setRiskDialog(null); setActionLoading(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500 shrink-0" />
              Sync aún considerado riesgoso
            </DialogTitle>
            <DialogDescription className="pt-1">
              {riskDialog?.reason}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            ¿Querés aprobar de todos modos y sincronizar con WooCommerce?
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRiskDialog(null); setActionLoading(null); }}
            >
              Cancelar
            </Button>
            <Button
              onClick={riskDialog?.onConfirm}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              Aprobar de todos modos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
