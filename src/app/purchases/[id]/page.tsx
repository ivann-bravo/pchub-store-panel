"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/layout/page-header";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Copy, Lock, Plus, Trash2, TrendingUp, Package, DollarSign, ShoppingBag, Search,
  AlertTriangle, AlertCircle, PackageCheck, X,
} from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Alternative {
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  supplierProductCode: string;
  finalCostArs: number;
  stockQty: number;
}

interface ClientBreakdown {
  itemId: number;
  wcOrderRef: string | null;
  wcOrderId: number | null;
  quantity: number;
  clientPaidAmount: number | null;
}

interface PurchaseItem {
  id: number;
  allIds: number[];
  productId: number;
  productName: string;
  productSku: string | null;
  supplierId: number;
  supplierCode: string;
  quantity: number;
  unitCostArs: number | null;
  clientPaidAmount: number | null;
  wcOrderId: number | null;
  wcOrderRef: string | null;
  goesToStock: boolean;
  stockEntryPrice: number | null;
  notes: string | null;
  stockAlertStatus: "out_of_stock" | "alt_available" | "back_in_stock" | null;
  assignedSupplierStockQty: number;
  alternatives: Alternative[];
  clientBreakdowns: ClientBreakdown[];
}

interface MarginData {
  cashRevenue: number;
  stockValue: number;
  cost: number;
  cashMargin: number;
  totalMargin: number;
}

interface PurchaseOrder {
  id: number;
  supplierId: number;
  supplierName: string;
  supplierCode: string;
  status: "open" | "closed";
  supplierOrderNumber: string | null;
  totalPaid: number | null;
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
  items: PurchaseItem[];
  margin: MarginData | null;
}

interface ProductSearchResult {
  id: number;
  name: string;
  sku: string | null;
  bestSupplierCost: number | null;
  bestSupplierCode: string | null;
}

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);

  // Add item state
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductSearchResult | null>(null);
  const [addQty, setAddQty] = useState("1");
  const [addClientPaid, setAddClientPaid] = useState("");
  const [addGoesToStock, setAddGoesToStock] = useState(false);
  const [addingItem, setAddingItem] = useState(false);

  // Close order state
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [closeOrderNumber, setCloseOrderNumber] = useState("");
  const [closeTotalPaid, setCloseTotalPaid] = useState("");
  const [stockPrices, setStockPrices] = useState<Record<number, string>>({});
  const [closing, setClosing] = useState(false);

  const fetchOrder = useCallback(async () => {
    const res = await fetch(`/api/purchases/${params.id}`);
    if (!res.ok) { setLoading(false); return; }
    const data = await res.json() as PurchaseOrder;
    setOrder(data);
    // Pre-fill stock prices from existing data
    const prices: Record<number, string> = {};
    data.items.filter((i) => i.goesToStock).forEach((i) => {
      if (i.stockEntryPrice) prices[i.id] = String(i.stockEntryPrice);
    });
    setStockPrices(prices);
    setLoading(false);
  }, [params.id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  // Product search for add item
  useEffect(() => {
    if (productSearch.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/products?search=${encodeURIComponent(productSearch)}&limit=10`);
      const data = await res.json();
      setSearchResults(data.products ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [productSearch]);

  const handleDeleteItem = async (item: PurchaseItem) => {
    // Delete all DB rows for this product (there may be multiple from different WC orders)
    await Promise.all(
      item.allIds.map((id) => fetch(`/api/purchases/${params.id}/items/${id}`, { method: "DELETE" }))
    );
    fetchOrder();
  };

  const handleToggleStock = async (item: PurchaseItem) => {
    // Toggle all DB rows for this product consistently
    await Promise.all(
      item.allIds.map((id) =>
        fetch(`/api/purchases/${params.id}/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goesToStock: !item.goesToStock }),
        })
      )
    );
    fetchOrder();
  };

  const handleDismissAlert = async (item: PurchaseItem) => {
    await Promise.all(
      item.allIds.map((id) =>
        fetch(`/api/purchases/${params.id}/items/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stockAlertStatus: null }),
        })
      )
    );
    fetchOrder();
  };

  const handleAddItem = async () => {
    if (!selectedProduct) return;
    setAddingItem(true);
    try {
      const res = await fetch(`/api/purchases/${params.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct.id,
          quantity: parseInt(addQty) || 1,
          clientPaidAmount: addGoesToStock ? null : (parseFloat(addClientPaid) || null),
          goesToStock: addGoesToStock,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error);
      }
      toast.success("Ítem agregado");
      setAddItemOpen(false);
      setSelectedProduct(null);
      setProductSearch("");
      setAddQty("1");
      setAddClientPaid("");
      setAddGoesToStock(false);
      fetchOrder();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al agregar ítem");
    } finally {
      setAddingItem(false);
    }
  };

  const handleCloseOrder = async () => {
    if (!closeTotalPaid) return;
    setClosing(true);
    try {
      const stockUpdates = order?.items
        .filter((i) => i.goesToStock)
        .map((i) => ({ itemId: i.id, stockEntryPrice: parseFloat(stockPrices[i.id] ?? "0") || 0 })) ?? [];

      const res = await fetch(`/api/purchases/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          supplierOrderNumber: closeOrderNumber || null,
          totalPaid: parseFloat(closeTotalPaid),
          stockUpdates,
        }),
      });
      if (!res.ok) throw new Error("Error al cerrar la orden");
      toast.success("Compra cerrada correctamente");
      setCloseDialogOpen(false);
      fetchOrder();
    } catch {
      toast.error("Error al cerrar la orden");
    } finally {
      setClosing(false);
    }
  };

  const handleCopyList = () => {
    if (!order) return;
    const lines: string[] = [
      `Compra ${order.supplierName} — Total estimado: ${formatARS(estimatedTotal)}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ...order.items.map((item) =>
        `${item.quantity}x ${item.productName}\n   COD. ${item.supplierCode || "—"}`
      ),
      "━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Lista copiada al portapapeles");
  };

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted rounded w-48"/><div className="h-64 bg-muted rounded"/></div>;
  if (!order) return <div className="text-center py-20 text-muted-foreground">Orden no encontrada</div>;

  const estimatedTotal = order.items.reduce((s, i) => s + (i.unitCostArs ?? 0) * i.quantity, 0);
  const clientTotal = order.items.filter((i) => !i.goesToStock).reduce((s, i) => s + (i.clientPaidAmount ?? 0), 0);
  const stockItems = order.items.filter((i) => i.goesToStock);
  const isOpen = order.status === "open";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${order.supplierName} — ${isOpen ? "Orden Abierta" : "Compra Cerrada"}`}
        breadcrumbs={[{ label: "Compras", href: "/purchases" }, { label: order.supplierName }]}
        actions={
          <div className="flex items-center gap-2">
            {isOpen && !isViewer && (
              <>
                <Button variant="outline" onClick={handleCopyList} disabled={order.items.length === 0}>
                  <Copy className="h-4 w-4 mr-2" /> Copiar lista
                </Button>
                <Button variant="outline" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" /> Agregar ítem
                </Button>
                <Button
                  onClick={() => {
                    setCloseTotalPaid(estimatedTotal > 0 ? estimatedTotal.toFixed(2) : "");
                    setCloseDialogOpen(true);
                  }}
                  disabled={order.items.length === 0}
                >
                  <Lock className="h-4 w-4 mr-2" /> Cerrar compra
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={() => router.push("/purchases")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Total estimado</p>
            </div>
            <p className="text-xl font-bold">{formatARS(estimatedTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-green-600" />
              <p className="text-xs text-muted-foreground">Ingreso cliente</p>
            </div>
            <p className="text-xl font-bold text-green-600">{formatARS(clientTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <Package className="h-3.5 w-3.5 text-blue-600" />
              <p className="text-xs text-muted-foreground">A stock ({stockItems.length} ítems)</p>
            </div>
            <p className="text-xl font-bold text-blue-600">
              {formatARS(stockItems.reduce((s, i) => s + (i.unitCostArs ?? 0) * i.quantity, 0))}
            </p>
          </CardContent>
        </Card>
        {order.status === "closed" && order.margin ? (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <p className="text-xs text-muted-foreground">Margen total</p>
              </div>
              <p className={`text-xl font-bold ${order.margin.totalMargin >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {formatARS(order.margin.totalMargin)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cash: {formatARS(order.margin.cashMargin)}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <p className="text-xs text-muted-foreground mb-1">Estado</p>
              <Badge variant={isOpen ? "outline" : "secondary"} className="text-sm">
                {isOpen ? "Abierta" : "Cerrada"}
              </Badge>
              {order.supplierOrderNumber && (
                <p className="text-xs text-muted-foreground mt-1">Pedido #{order.supplierOrderNumber}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Items table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Ítems ({order.items.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {order.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
              <ShoppingBag className="h-8 w-8 opacity-25" />
              <p className="text-sm">Sin ítems todavía</p>
              {isOpen && !isViewer && (
                <Button variant="outline" size="sm" onClick={() => setAddItemOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar ítem
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Producto</TableHead>
                  <TableHead>Cod. Proveedor</TableHead>
                  <TableHead className="text-center">Cant.</TableHead>
                  <TableHead className="text-right">Costo unit.</TableHead>
                  <TableHead className="text-right">Cliente pagó</TableHead>
                  <TableHead className="text-center">A stock</TableHead>
                  <TableHead className="pl-2">WC Pedido</TableHead>
                  {isOpen && !isViewer && <TableHead />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {order.items.map((item) => (
                  <TableRow key={item.id} className={item.goesToStock ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}>
                    <TableCell className="pl-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{item.productName}</p>
                        {item.productSku && (
                          <p className="text-xs font-mono text-muted-foreground">{item.productSku}</p>
                        )}
                        {/* Per-order breakdown when the same product came from multiple WC orders */}
                        {item.clientBreakdowns.length > 1 && (
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                            {item.clientBreakdowns.map((b) => (
                              <span key={b.itemId} className="text-[11px] text-muted-foreground">
                                {b.wcOrderRef ? `#${b.wcOrderRef}` : "Manual"}: {b.quantity}x
                                {b.clientPaidAmount ? ` (${formatARS(b.clientPaidAmount)})` : ""}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.alternatives.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {item.alternatives.map((alt) => (
                              <Badge key={alt.supplierId} variant="outline" className="text-[10px] text-orange-600 border-orange-300">
                                También en {alt.supplierName}: {formatARS(alt.finalCostArs)}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {item.stockAlertStatus && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            {item.stockAlertStatus === "out_of_stock" && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5">
                                <AlertCircle className="h-3 w-3" /> Sin stock — ningún proveedor
                              </span>
                            )}
                            {item.stockAlertStatus === "alt_available" && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded px-1.5 py-0.5">
                                <AlertTriangle className="h-3 w-3" /> Sin stock aquí — hay alternativas
                              </span>
                            )}
                            {item.stockAlertStatus === "back_in_stock" && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                                <PackageCheck className="h-3 w-3" /> ¡Volvió al stock!
                              </span>
                            )}
                            {!isViewer && (
                              <button
                                type="button"
                                onClick={() => handleDismissAlert(item)}
                                className="text-muted-foreground hover:text-foreground transition-colors"
                                title="Descartar alerta"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        {item.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">{item.notes}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.supplierCode || "—"}</TableCell>
                    <TableCell className="text-center font-medium">{item.quantity}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {item.unitCostArs ? formatARS(item.unitCostArs) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-green-700">
                      {item.clientPaidAmount ? formatARS(item.clientPaidAmount) : (item.goesToStock ? <span className="text-blue-500 text-xs">Stock</span> : "—")}
                    </TableCell>
                    <TableCell className="text-center">
                      {isOpen && !isViewer ? (
                        <Checkbox
                          checked={item.goesToStock}
                          onCheckedChange={() => handleToggleStock(item)}
                        />
                      ) : (
                        item.goesToStock ? <Badge className="text-xs bg-blue-600 hover:bg-blue-600">Stock</Badge> : null
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.clientBreakdowns.length > 1
                        ? item.clientBreakdowns.filter((b) => b.wcOrderRef).map((b) => `#${b.wcOrderRef}`).join(", ") || "—"
                        : item.wcOrderRef ? `#${item.wcOrderRef}` : "—"}
                    </TableCell>
                    {isOpen && !isViewer && (
                      <TableCell className="pr-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
                          onClick={() => handleDeleteItem(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Closed order margin detail */}
      {order.status === "closed" && order.margin && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Resumen de Margen
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ingreso en plata (clientes)</span>
              <span className="font-medium text-green-600">{formatARS(order.margin.cashRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ingreso en stock (valor costo)</span>
              <span className="font-medium text-blue-600">{formatARS(order.margin.stockValue)}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Egreso proveedor</span>
              <span className="font-medium text-red-500">{formatARS(order.margin.cost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Margen cash</span>
              <span className={cn("font-bold", order.margin.cashMargin >= 0 ? "text-emerald-600" : "text-red-500")}>
                {formatARS(order.margin.cashMargin)}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="font-semibold">Margen total (cash + stock)</span>
              <span className={cn("text-lg font-bold", order.margin.totalMargin >= 0 ? "text-emerald-600" : "text-red-500")}>
                {formatARS(order.margin.totalMargin)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Item Dialog */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar ítem</DialogTitle>
            <DialogDescription>Buscá un producto del panel para agregar a esta orden.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar producto..."
                value={productSearch}
                onChange={(e) => { setProductSearch(e.target.value); setSelectedProduct(null); }}
                className="pl-8"
              />
            </div>

            {searchResults.length > 0 && !selectedProduct && (
              <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors"
                    onClick={() => { setSelectedProduct(p); setProductSearch(p.name); }}
                  >
                    <p className="text-sm font-medium">{p.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.sku && <span className="text-xs font-mono text-muted-foreground">{p.sku}</span>}
                      {p.bestSupplierCost && <span className="text-xs text-muted-foreground">{formatARS(p.bestSupplierCost)}</span>}
                      {p.bestSupplierCode && <Badge variant="outline" className="text-[10px]">{p.bestSupplierCode}</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedProduct && (
              <div className="space-y-3">
                <div className="p-2.5 rounded-lg bg-muted/50 text-sm">
                  <p className="font-medium">{selectedProduct.name}</p>
                  {selectedProduct.bestSupplierCost && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Mejor costo: {formatARS(selectedProduct.bestSupplierCost)} ({selectedProduct.bestSupplierCode})
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Cantidad</p>
                    <Input type="number" min="1" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
                  </div>
                  {!addGoesToStock && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Cliente pagó (ARS)</p>
                      <Input
                        type="number"
                        placeholder="0"
                        value={addClientPaid}
                        onChange={(e) => setAddClientPaid(e.target.value)}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="goesToStock"
                    checked={addGoesToStock}
                    onCheckedChange={(v: boolean | "indeterminate") => setAddGoesToStock(v === true)}
                  />
                  <label htmlFor="goesToStock" className="text-sm cursor-pointer">
                    Va a stock (no tiene cliente asignado)
                  </label>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemOpen(false)}>Cancelar</Button>
            <Button onClick={handleAddItem} disabled={!selectedProduct || addingItem}>
              {addingItem ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Order Dialog */}
      <Dialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cerrar compra</DialogTitle>
            <DialogDescription>
              Ingresá el número de pedido del proveedor y el total que pagaste.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Nº de pedido del proveedor</p>
              <Input
                placeholder="Ej: 45231"
                value={closeOrderNumber}
                onChange={(e) => setCloseOrderNumber(e.target.value)}
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Total pagado al proveedor (ARS)</p>
              <Input
                type="number"
                placeholder="0"
                value={closeTotalPaid}
                onChange={(e) => setCloseTotalPaid(e.target.value)}
              />
            </div>

            {stockItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Precio de entrada al stock
                </p>
                {stockItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <p className="text-sm flex-1 truncate">{item.quantity}x {item.productName}</p>
                    <Input
                      type="number"
                      placeholder={item.unitCostArs ? String(Math.round(item.unitCostArs)) : "0"}
                      value={stockPrices[item.id] ?? ""}
                      onChange={(e) => setStockPrices((p) => ({ ...p, [item.id]: e.target.value }))}
                      className="w-32 text-sm"
                    />
                  </div>
                ))}
              </div>
            )}

            {closeTotalPaid && (
              <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ingreso clientes</span>
                  <span className="font-medium text-green-600">{formatARS(clientTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pago proveedor</span>
                  <span className="font-medium text-red-500">{formatARS(parseFloat(closeTotalPaid) || 0)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1">
                  <span>Margen cash</span>
                  <span className={clientTotal - (parseFloat(closeTotalPaid) || 0) >= 0 ? "text-emerald-600" : "text-red-500"}>
                    {formatARS(clientTotal - (parseFloat(closeTotalPaid) || 0))}
                  </span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCloseOrder} disabled={!closeTotalPaid || closing}>
              {closing ? "Cerrando..." : "Cerrar compra"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
