"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ShoppingBag, Plus, TrendingUp, Package, DollarSign, ArrowDownToLine, ChevronRight, History, AlertTriangle, PackageCheck } from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";
import { WcImportModal } from "@/components/purchases/wc-import-modal";

interface PurchaseOrder {
  id: number;
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  status: "open" | "closed";
  supplierOrderNumber: string | null;
  totalPaid: number | null;
  createdAt: string;
  closedAt: string | null;
  itemCount: number;
  estimatedTotal: number;
  clientTotal: number;
  stockAlertCount: number;
  backInStockCount: number;
}

interface Supplier {
  id: number;
  name: string;
  code: string;
}

interface Stats {
  cashRevenue: number;
  stockValue: number;
  totalCost: number;
  cashMargin: number;
  totalMargin: number;
  orderCount: number;
  hasHistorical: boolean;
  weeklyBreakdown: { week: number; cashRevenue: number; stockValue: number; cost: number; cashMargin: number; totalMargin: number; orderCount: number; isHistorical?: boolean }[] | null;
}

const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));

export default function PurchasesPage() {
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const router = useRouter();

  const [openOrders, setOpenOrders] = useState<PurchaseOrder[]>([]);
  const [closedOrders, setClosedOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  // New order dialog
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderSupplierId, setNewOrderSupplierId] = useState<string>("");
  const [creating, setCreating] = useState(false);

  // WC Import modal
  const [wcImportOpen, setWcImportOpen] = useState(false);

  const fetchOrders = useCallback(async () => {
    const [open, closed] = await Promise.all([
      fetch("/api/purchases?status=open").then((r) => r.json()),
      fetch("/api/purchases?status=closed").then((r) => r.json()),
    ]);
    setOpenOrders(Array.isArray(open) ? open : []);
    setClosedOrders(Array.isArray(closed) ? closed : []);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await fetch(`/api/purchases/stats?year=${selectedYear}&month=${selectedMonth}`);
    const data = await res.json();
    setStats(data);
  }, [selectedYear, selectedMonth]);

  const fetchSuppliers = useCallback(async () => {
    const res = await fetch("/api/suppliers");
    const data = await res.json();
    setSuppliers(Array.isArray(data) ? data.filter((s: Supplier & { isActive: boolean }) => s.isActive) : []);
  }, []);

  useEffect(() => {
    Promise.all([fetchOrders(), fetchStats(), fetchSuppliers()]).finally(() => setLoading(false));
  }, [fetchOrders, fetchStats, fetchSuppliers]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleCreateOrder = async () => {
    if (!newOrderSupplierId) return;
    setCreating(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId: parseInt(newOrderSupplierId) }),
      });
      if (!res.ok) throw new Error("Error al crear");
      const order = await res.json() as PurchaseOrder;
      setNewOrderOpen(false);
      setNewOrderSupplierId("");
      router.push(`/purchases/${order.id}`);
    } catch {
      toast.error("Error al crear la orden");
    } finally {
      setCreating(false);
    }
  };

  const months = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];

  const recentClosed = closedOrders.slice(0, 5);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Órdenes de Compra"
        breadcrumbs={[{ label: "Compras" }]}
        description="Gestión de pedidos a proveedores"
        actions={
          !isViewer ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setWcImportOpen(true)}>
                <ArrowDownToLine className="h-4 w-4 mr-2" /> Importar desde WC
              </Button>
              <Button onClick={() => setNewOrderOpen(true)}>
                <Plus className="h-4 w-4 mr-2" /> Nueva Orden
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="flex items-center gap-3">
        <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(parseInt(v))}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {months.map((m, i) => (
              <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
          <SelectTrigger className="w-[100px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: now.getFullYear() - 2022 }, (_, i) => 2023 + i).map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  <p className="text-xs text-muted-foreground">Ingreso plata</p>
                </div>
                <p className="text-2xl font-bold text-green-600">{formatARS(stats.cashRevenue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <Package className="h-4 w-4 text-blue-600" />
                  <p className="text-xs text-muted-foreground">Ingreso stock</p>
                </div>
                <p className="text-2xl font-bold text-blue-600">{formatARS(stats.stockValue)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <ShoppingBag className="h-4 w-4 text-red-500" />
                  <p className="text-xs text-muted-foreground">Egreso proveedores</p>
                </div>
                <p className="text-2xl font-bold text-red-500">{formatARS(stats.totalCost)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <p className="text-xs text-muted-foreground">Margen cash</p>
                </div>
                <p className={`text-2xl font-bold ${stats.cashMargin >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                  {formatARS(stats.cashMargin)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <p className="text-xs text-muted-foreground">Margen total</p>
                </div>
                <p className={`text-2xl font-bold ${stats.totalMargin >= 0 ? "text-primary" : "text-red-500"}`}>
                  {formatARS(stats.totalMargin)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{stats.orderCount} compras cerradas</p>
              </CardContent>
            </Card>
          </div>

          {/* Weekly breakdown */}
          {stats.weeklyBreakdown && (stats.orderCount > 0 || stats.hasHistorical) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Desglose semanal — {months[selectedMonth - 1]} {selectedYear}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-3">
                  {stats.weeklyBreakdown.map((w) => (
                    <div key={w.week} className="rounded-lg border p-3 space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Semana {w.week}</p>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Plata</span>
                        <span className="font-medium text-green-600">{formatARS(w.cashRevenue)}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Stock</span>
                        <span className="font-medium text-blue-600">{formatARS(w.stockValue)}</span>
                      </div>
                      <div className="flex justify-between text-xs border-t pt-1.5">
                        <span className="text-muted-foreground">Margen</span>
                        <span className={`font-bold ${w.totalMargin >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                          {formatARS(w.totalMargin)}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{w.orderCount} compras</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Open orders */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Órdenes Abiertas
            {openOrders.length > 0 && <Badge variant="secondary">{openOrders.length}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : openOrders.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">No hay órdenes abiertas</p>
              {!isViewer && (
                <p className="text-xs mt-1">Creá una nueva orden o importá desde WooCommerce</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {openOrders.map((order) => (
                <Link key={order.id} href={`/purchases/${order.id}`}>
                  <div className="flex items-center justify-between rounded-lg border p-3.5 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <ShoppingBag className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{order.supplierName}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.itemCount} {order.itemCount === 1 ? "ítem" : "ítems"}
                          {order.estimatedTotal > 0 && ` · Est. ${formatARS(order.estimatedTotal)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {order.backInStockCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                          <PackageCheck className="h-3 w-3" /> {order.backInStockCount} volvió
                        </span>
                      )}
                      {order.stockAlertCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          <AlertTriangle className="h-3 w-3" /> {order.stockAlertCount} sin stock
                        </span>
                      )}
                      <Badge variant="outline" className="text-xs">Abierta</Badge>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent closed orders */}
      {recentClosed.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <History className="h-4 w-4" />
              Últimas Compras Cerradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentClosed.map((order) => (
                <Link key={order.id} href={`/purchases/${order.id}`}>
                  <div className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{order.supplierName}</p>
                        {order.supplierOrderNumber && (
                          <span className="text-xs font-mono text-muted-foreground">#{order.supplierOrderNumber}</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {order.itemCount} ítems
                        {order.closedAt && ` · ${new Date(order.closedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit" })}`}
                      </p>
                    </div>
                    <div className="text-right">
                      {order.totalPaid != null && (
                        <p className="text-sm font-semibold text-red-500">{formatARS(order.totalPaid)}</p>
                      )}
                      <Badge variant="secondary" className="text-xs">Cerrada</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* New Order Dialog */}
      <Dialog open={newOrderOpen} onOpenChange={setNewOrderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nueva Orden de Compra</DialogTitle>
            <DialogDescription>Seleccioná el proveedor al que le vas a comprar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Select value={newOrderSupplierId} onValueChange={setNewOrderSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar proveedor..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="w-full" onClick={handleCreateOrder} disabled={!newOrderSupplierId || creating}>
              {creating ? "Creando..." : "Crear orden"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* WC Import Modal */}
      {!isViewer && (
        <WcImportModal
          open={wcImportOpen}
          onClose={() => setWcImportOpen(false)}
          onImported={() => { setWcImportOpen(false); fetchOrders(); }}
        />
      )}
    </div>
  );
}
