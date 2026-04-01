"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Package, DollarSign, Tag, Truck, AlertTriangle, TrendingUp, TrendingDown, PackageX, ShieldAlert, PackageCheck, AlertCircle } from "lucide-react";
import { formatARS } from "@/lib/number-format";
import Link from "next/link";
import type { DashboardStats, ExchangeRate, PriceAlert, StaleStockAlert } from "@/types";

interface PurchaseStockAlert {
  itemId: number;
  purchaseOrderId: number;
  productId: number;
  productName: string;
  productSku: string | null;
  supplierId: number;
  supplierName: string;
  quantity: number;
  stockAlertStatus: "out_of_stock" | "alt_available" | "back_in_stock";
  wcOrderRef: string | null;
}

interface WooSyncBlockedItem {
  id: number;
  productId: number;
  productName: string;
  reason: string;
  newPrice: number | null;
  oldPrice: number | null;
  createdAt: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [staleStock, setStaleStock] = useState<StaleStockAlert[]>([]);
  const [blockedSyncs, setBlockedSyncs] = useState<{ items: WooSyncBlockedItem[]; pendingCount: number } | null>(null);
  const [purchaseStockAlerts, setPurchaseStockAlerts] = useState<PurchaseStockAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/exchange-rate").then((r) => r.json()),
      fetch("/api/price-alerts?limit=10").then((r) => r.json()),
      fetch("/api/stale-stock").then((r) => r.json()),
      fetch("/api/woocommerce/sync-blocked?status=pending&limit=5").then((r) => r.json()).catch(() => null),
      fetch("/api/purchases/stock-alerts").then((r) => r.json()).catch(() => []),
    ])
      .then(([statsData, rateData, alertsData, staleData, blockedData, purchaseAlertsData]) => {
        setStats(statsData);
        setExchangeRate(rateData.error ? null : rateData);
        setAlerts(Array.isArray(alertsData?.alerts) ? alertsData.alerts : Array.isArray(alertsData) ? alertsData : []);
        setStaleStock(Array.isArray(staleData) ? staleData : []);
        if (blockedData && blockedData.pendingCount > 0) setBlockedSyncs(blockedData);
        setPurchaseStockAlerts(Array.isArray(purchaseAlertsData) ? purchaseAlertsData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const refreshRate = async () => {
    try {
      const res = await fetch("/api/exchange-rate", { method: "POST" });
      const data = await res.json();
      if (!data.error) setExchangeRate(data);
    } catch (e) {
      console.error("Failed to refresh exchange rate", e);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Dashboard"
          description="Resumen general del sistema"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="hover:shadow-md">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-8 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-20 mb-2" />
                <Skeleton className="h-3 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Resumen general del sistema"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Productos</CardTitle>
            <div className="p-2 bg-primary/10 rounded-full">
              <Package className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalProducts?.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.categoriesCount} categorías · {stats?.brandsCount} marcas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Con Precio</CardTitle>
            <div className="p-2 bg-success/10 rounded-full">
              <DollarSign className="h-4 w-4 text-success" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {stats?.withPrice?.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.withoutPrice?.toLocaleString()} sin precio
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">En Oferta</CardTitle>
            <div className="p-2 bg-warning/10 rounded-full">
              <Tag className="h-4 w-4 text-warning" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-warning">
              {stats?.onOffer?.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">con markup oferta activo</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Proveedores</CardTitle>
            <div className="p-2 bg-info/10 rounded-full">
              <Truck className="h-4 w-4 text-info" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.totalSuppliers}</div>
            <p className="text-xs text-muted-foreground">proveedores activos</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Cotización Dólar Oficial</CardTitle>
            <Button variant="link" size="sm" onClick={refreshRate} className="h-auto p-0 text-sm">
              Actualizar
            </Button>
          </CardHeader>
          <CardContent>
            {exchangeRate ? (
              <div className="flex gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Compra</p>
                  <p className="text-2xl font-bold">
                    {formatARS(exchangeRate.buyRate)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Venta</p>
                  <p className="text-2xl font-bold text-success">
                    {formatARS(exchangeRate.sellRate)}
                  </p>
                </div>
                <div className="flex items-end">
                  <p className="text-xs text-muted-foreground">
                    {new Date(exchangeRate.fetchedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">
                No hay cotización cargada.{" "}
                <Button variant="link" size="sm" onClick={refreshRate} className="h-auto p-0">
                  Obtener ahora
                </Button>
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Últimas Importaciones</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.recentImports && stats.recentImports.length > 0 ? (
              <div className="space-y-2">
                {stats.recentImports.map((imp) => (
                  <div key={imp.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{imp.supplierName}</span>
                      <span className="text-muted-foreground ml-2">{imp.filename}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{imp.rowCount} filas</Badge>
                      <Badge variant={imp.status === "completed" ? "default" : "secondary"}>
                        {imp.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No hay importaciones recientes</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Price Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-lg">Alertas de Precio ({alerts.length})</CardTitle>
            <div className="flex-1" />
            <Link href="/pricing/alerts" className="text-sm text-primary hover:underline">
              Ver todas &rarr;
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Fuente</TableHead>
                  <TableHead className="text-right">Anterior</TableHead>
                  <TableHead className="text-right">Nuevo</TableHead>
                  <TableHead className="text-right">Cambio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert, i) => (
                  <TableRow key={`${alert.productId}-${alert.source}-${i}`}>
                    <TableCell>
                      <Link
                        href={`/products/${alert.productId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {alert.productName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{alert.source}</TableCell>
                    <TableCell className="text-right">{formatARS(alert.previousPrice)}</TableCell>
                    <TableCell className="text-right">{formatARS(alert.currentPrice)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`inline-flex items-center gap-1 font-medium ${
                        alert.changePercent > 0 ? "text-red-600" : "text-green-600"
                      }`}>
                        {alert.changePercent > 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {alert.changePercent > 0 ? "+" : ""}{alert.changePercent}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Stale Stock Alerts */}
      {staleStock.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <PackageX className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">Stock Agotado ({staleStock.length})</CardTitle>
            <div className="flex-1" />
            <Link href="/products?localStock=none" className="text-sm text-primary hover:underline">
              Ver todos &rarr;
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-center">Meses sin stock</TableHead>
                  <TableHead className="text-right">Última actualización</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staleStock.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/products/${item.id}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.category || "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant={item.severity === "critical" ? "destructive" : "secondary"}
                        className={
                          item.severity === "danger"
                            ? "bg-orange-500 hover:bg-orange-600 text-white"
                            : item.severity === "warning"
                            ? "bg-yellow-500 hover:bg-yellow-600 text-white"
                            : ""
                        }
                      >
                        {item.monthsStale} {item.monthsStale === 1 ? "mes" : "meses"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {new Date(item.updatedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {/* Purchase Order Stock Alerts */}
      {purchaseStockAlerts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">
              Stock en Órdenes de Compra
            </CardTitle>
            <Badge variant="destructive" className="ml-1">{purchaseStockAlerts.length}</Badge>
            <div className="flex-1" />
            <Link href="/purchases" className="text-sm text-primary hover:underline">
              Ver órdenes &rarr;
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Proveedor asignado</TableHead>
                  <TableHead>Pedido WC</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {purchaseStockAlerts.map((alert) => (
                  <TableRow key={alert.itemId}>
                    <TableCell>
                      <Link
                        href={`/purchases/${alert.purchaseOrderId}`}
                        className="text-primary hover:underline font-medium"
                      >
                        {alert.quantity > 1 && <span className="text-muted-foreground mr-1">{alert.quantity}x</span>}
                        {alert.productName}
                      </Link>
                      {alert.productSku && (
                        <p className="text-xs font-mono text-muted-foreground">{alert.productSku}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{alert.supplierName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {alert.wcOrderRef ? `#${alert.wcOrderRef}` : "—"}
                    </TableCell>
                    <TableCell>
                      {alert.stockAlertStatus === "out_of_stock" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                          <AlertCircle className="h-3 w-3" /> Sin stock en ningún lado
                        </span>
                      )}
                      {alert.stockAlertStatus === "alt_available" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                          <AlertTriangle className="h-3 w-3" /> Sin stock — hay alternativas
                        </span>
                      )}
                      {alert.stockAlertStatus === "back_in_stock" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                          <PackageCheck className="h-3 w-3" /> ¡Volvió al stock!
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Blocked WooCommerce Syncs */}
      {blockedSyncs && blockedSyncs.pendingCount > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            <CardTitle className="text-lg">
              Syncs Bloqueados
            </CardTitle>
            <Badge variant="destructive" className="ml-1">{blockedSyncs.pendingCount}</Badge>
            <div className="flex-1" />
            <Link href="/woocommerce/revision" className="text-sm text-primary hover:underline">
              Ver todos &rarr;
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Precio Ant.</TableHead>
                  <TableHead className="text-right">Precio Nuevo</TableHead>
                  <TableHead className="text-right">Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blockedSyncs.items.map((item) => {
                  const pct = item.oldPrice && item.newPrice
                    ? Math.round((1 - item.newPrice / item.oldPrice) * 100)
                    : null;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Link href={`/products/${item.productId}`} className="text-primary hover:underline font-medium">
                          {item.productName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-xs truncate">{item.reason}</TableCell>
                      <TableCell className="text-right text-sm">
                        {item.oldPrice ? formatARS(item.oldPrice) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {item.newPrice ? formatARS(item.newPrice) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {pct != null && <span className="text-red-600 font-medium mr-2">-{pct}%</span>}
                        {new Date(item.createdAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
