"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Trash2,
  ArrowUpDown,
} from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";

interface PriceAlert {
  productId: number;
  productName: string;
  source: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  recordedAt: string;
}

export default function PriceAlertsPage() {
  return (
    <Suspense fallback={<div className="h-64 bg-muted animate-pulse rounded" />}>
      <PriceAlertsContent />
    </Suspense>
  );
}

function PriceAlertsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [minPercent, setMinPercent] = useState("");
  const [maxPercent, setMaxPercent] = useState("");

  const page = parseInt(searchParams.get("page") || "1");
  const search = searchParams.get("search") || "";
  const direction = searchParams.get("direction") || "all";
  const sortBy = searchParams.get("sortBy") || "change";
  const sortOrder = searchParams.get("sortOrder") || "desc";
  const [searchInput, setSearchInput] = useState(search);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "50",
      direction,
      sortBy,
      sortOrder,
    });
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/price-alerts?${params}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar alertas");
    } finally {
      setLoading(false);
    }
  }, [page, search, direction, sortBy, sortOrder]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v) params.set(k, v);
      else params.delete(k);
    });
    router.push(`/pricing/alerts?${params}`);
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      updateParams({ sortOrder: sortOrder === "desc" ? "asc" : "desc", page: "1" });
    } else {
      updateParams({ sortBy: column, sortOrder: "desc", page: "1" });
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Eliminar historial de precios anterior a 30 dias?")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/price-alerts", { method: "DELETE" });
      const data = await res.json();
      toast.success(data.message || `${data.deleted} registros eliminados`);
      fetchAlerts();
    } catch {
      toast.error("Error al limpiar historial");
    } finally {
      setClearing(false);
    }
  };

  // Count how many visible alerts match the % range filter
  const filteredAlertCount = alerts.filter((a) => {
    const abs = Math.abs(a.changePercent);
    if (minPercent && abs < parseFloat(minPercent)) return false;
    if (maxPercent && abs > parseFloat(maxPercent)) return false;
    return true;
  }).length;

  const handleClearFiltered = async () => {
    const hasFilter = !!(minPercent || maxPercent);
    const clearCount = hasFilter ? filteredAlertCount : total;
    const rangeLabel = hasFilter
      ? `con cambio entre ${minPercent || "0"}% y ${maxPercent || "∞"}%`
      : "(todas)";
    if (!confirm(`Limpiar ${clearCount} alertas ${rangeLabel}?`)) return;
    setClearing(true);
    try {
      const params = new URLSearchParams();
      // Always set minPercent to trigger the dismiss-alerts branch in the API
      params.set("minPercent", minPercent || "0");
      if (maxPercent) params.set("maxPercent", maxPercent);
      if (direction !== "all") params.set("direction", direction);
      const res = await fetch(`/api/price-alerts?${params}`, { method: "DELETE" });
      const data = await res.json();
      toast.success(data.message || `${data.alertsCleaned} alertas limpiadas`);
      fetchAlerts();
    } catch {
      toast.error("Error al limpiar alertas");
    } finally {
      setClearing(false);
    }
  };

  const SortHeader = ({ column, children }: { column: string; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none"
      onClick={() => toggleSort(column)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortBy === column && (
          <ArrowUpDown className="h-3 w-3" />
        )}
      </span>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Alertas de Precio"
        breadcrumbs={[{ label: "Precios", href: "/pricing" }, { label: "Alertas de Precio" }]}
        description="Variaciones de precios detectadas en las últimas sincronizaciones"
        actions={
          !isViewer && (
            <Button variant="outline" onClick={handleClearHistory} disabled={clearing}>
              <Trash2 className="h-4 w-4 mr-1" />
              Limpiar historial (+30d)
            </Button>
          )
        }
      />

      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2 items-center flex-wrap">
            <Input
              placeholder="Buscar producto..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && updateParams({ search: searchInput, page: "1" })}
              className="max-w-md"
            />
            <Button onClick={() => updateParams({ search: searchInput, page: "1" })} variant="secondary">
              <Search className="h-4 w-4" />
            </Button>
            <Select
              value={direction}
              onValueChange={(v) => updateParams({ direction: v, page: "1" })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Direccion" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="up">Subieron</SelectItem>
                <SelectItem value="down">Bajaron</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                placeholder="% min"
                value={minPercent}
                onChange={(e) => setMinPercent(e.target.value)}
                className="w-[80px]"
              />
              <span className="text-muted-foreground text-sm">-</span>
              <Input
                type="number"
                placeholder="% max"
                value={maxPercent}
                onChange={(e) => setMaxPercent(e.target.value)}
                className="w-[80px]"
              />
            </div>
            {!isViewer && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleClearFiltered}
                disabled={clearing}
                title={
                  minPercent || maxPercent
                    ? `Limpiar ${filteredAlertCount} alertas en el rango`
                    : `Limpiar todas las alertas (${total.toLocaleString()})`
                }
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {minPercent || maxPercent
                  ? `Limpiar filtradas (${filteredAlertCount})`
                  : `Limpiar todas (${total.toLocaleString()})`}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHeader column="product">Producto</SortHeader>
                <SortHeader column="source">Proveedor</SortHeader>
                <SortHeader column="previous">
                  <span className="text-right w-full">Anterior</span>
                </SortHeader>
                <SortHeader column="current">
                  <span className="text-right w-full">Nuevo</span>
                </SortHeader>
                <SortHeader column="change">
                  <span className="text-right w-full">Cambio %</span>
                </SortHeader>
                <SortHeader column="date">Fecha</SortHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(6)].map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-muted animate-pulse rounded w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : alerts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No hay alertas de precio
                  </TableCell>
                </TableRow>
              ) : (
                alerts.map((alert, i) => (
                  <TableRow key={`${alert.productId}-${alert.source}-${i}`}>
                    <TableCell className="max-w-[300px] truncate">
                      <Link
                        href={`/products/${alert.productId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {alert.productName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {alert.source}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatARS(alert.previousPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatARS(alert.currentPrice)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`inline-flex items-center gap-1 font-medium ${
                          alert.changePercent > 0 ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {alert.changePercent > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {alert.changePercent > 0 ? "+" : ""}
                        {alert.changePercent}%
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(alert.recordedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} alertas
        </p>
        {totalPages > 1 && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => updateParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="flex items-center text-sm px-2">
              Pagina {page} de {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => updateParams({ page: String(page + 1) })}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
