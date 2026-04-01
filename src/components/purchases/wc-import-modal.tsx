"use client";

import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";
import { RefreshCw, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

interface WcLineItem {
  wcLineItemId: number;
  wcProductId: number;
  name: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  panelProductId: number | null;
  panelProductName: string | null;
  matched: boolean;
}

interface WcOrder {
  wcOrderId: number;
  wcOrderRef: string;
  customerName: string;
  dateCreated: string;
  total: number;
  lineItems: WcLineItem[];
}

interface SelectedItem {
  wcOrderId: number;
  wcOrderRef: string;
  lineItem: WcLineItem;
  clientPaidAmount: string;
}

interface WcImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export function WcImportModal({ open, onClose, onImported }: WcImportModalProps) {
  const [orders, setOrders] = useState<WcOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setSelected(new Map());
    fetch("/api/woocommerce/orders")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        const wcOrders: WcOrder[] = data.orders ?? [];
        setOrders(wcOrders);
        // Expand all orders by default
        setExpandedOrders(new Set(wcOrders.map((o) => o.wcOrderId)));
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open]);

  const itemKey = (orderId: number, lineItemId: number) => `${orderId}-${lineItemId}`;

  const toggleItem = (order: WcOrder, item: WcLineItem) => {
    const key = itemKey(order.wcOrderId, item.wcLineItemId);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, {
          wcOrderId: order.wcOrderId,
          wcOrderRef: order.wcOrderRef,
          lineItem: item,
          clientPaidAmount: item.lineTotal.toFixed(2),
        });
      }
      return next;
    });
  };

  const updateClientPaid = (key: string, value: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      const item = next.get(key);
      if (item) next.set(key, { ...item, clientPaidAmount: value });
      return next;
    });
  };

  const handleImport = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      const items = Array.from(selected.values());
      let imported = 0;

      for (const sel of items) {
        if (!sel.lineItem.matched || !sel.lineItem.panelProductId) continue;

        const addRes = await fetch("/api/purchases/add-from-wc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: sel.lineItem.panelProductId,
            quantity: sel.lineItem.quantity,
            clientPaidAmount: parseFloat(sel.clientPaidAmount) || sel.lineItem.lineTotal,
            wcOrderId: sel.wcOrderId,
            wcOrderRef: sel.wcOrderRef,
          }),
        });
        if (addRes.ok) imported++;
      }

      if (imported > 0) {
        toast.success(`${imported} ítem${imported > 1 ? "s" : ""} importado${imported > 1 ? "s" : ""} a las órdenes de compra`);
        onImported();
      } else {
        toast.warning("No se pudo importar ningún ítem. Verificá que los productos tengan proveedores vinculados.");
      }
    } catch {
      toast.error("Error al importar ítems");
    } finally {
      setSaving(false);
    }
  };

  const matchedSelected = Array.from(selected.values()).filter((s) => s.lineItem.matched);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar desde WooCommerce</DialogTitle>
          <DialogDescription>
            Pedidos en estado <strong>Procesando</strong>. Seleccioná los ítems que necesitás comprar.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-muted-foreground">Cargando pedidos...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && orders.length === 0 && (
          <div className="text-center py-10 text-muted-foreground">
            <p className="text-sm">No hay pedidos en estado &quot;Procesando&quot;</p>
          </div>
        )}

        {!loading && orders.length > 0 && (
          <div className="space-y-3">
            {orders.map((order) => {
              const isExpanded = expandedOrders.has(order.wcOrderId);
              return (
                <div key={order.wcOrderId} className="border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                    onClick={() => setExpandedOrders((prev) => {
                      const next = new Set(prev);
                      if (next.has(order.wcOrderId)) next.delete(order.wcOrderId);
                      else next.add(order.wcOrderId);
                      return next;
                    })}
                  >
                    <div>
                      <span className="font-medium text-sm">Pedido #{order.wcOrderRef}</span>
                      <span className="text-xs text-muted-foreground ml-2">{order.customerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{formatARS(order.total)}</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="divide-y">
                      {order.lineItems.map((item) => {
                        const key = itemKey(order.wcOrderId, item.wcLineItemId);
                        const isSelected = selected.has(key);
                        const sel = selected.get(key);
                        return (
                          <div
                            key={item.wcLineItemId}
                            className={`flex items-start gap-3 px-4 py-3 ${!item.matched ? "opacity-50" : ""}`}
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => item.matched && toggleItem(order, item)}
                              disabled={!item.matched}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-medium truncate">{item.name}</p>
                                {!item.matched && (
                                  <Badge variant="outline" className="text-[10px] text-orange-600 border-orange-300">
                                    Sin vincular
                                  </Badge>
                                )}
                              </div>
                              {item.sku && <p className="text-xs text-muted-foreground font-mono">{item.sku}</p>}
                              <p className="text-xs text-muted-foreground">
                                {item.quantity}x · {formatARS(item.unitPrice)} c/u
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              {isSelected ? (
                                <div className="flex flex-col items-end gap-1">
                                  <p className="text-[10px] text-muted-foreground">Cliente pagó:</p>
                                  <Input
                                    type="number"
                                    value={sel?.clientPaidAmount ?? ""}
                                    onChange={(e) => updateClientPaid(key, e.target.value)}
                                    className="h-7 w-28 text-xs text-right"
                                  />
                                </div>
                              ) : (
                                <p className="text-sm font-medium">{formatARS(item.lineTotal)}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {selected.size > 0 && (
          <div className="flex items-center justify-between pt-2 border-t">
            <p className="text-sm text-muted-foreground">
              {matchedSelected.length} ítem{matchedSelected.length !== 1 ? "s" : ""} seleccionado{matchedSelected.length !== 1 ? "s" : ""}
              {selected.size > matchedSelected.length && (
                <span className="text-orange-600 ml-1">({selected.size - matchedSelected.length} sin vincular, se omiten)</span>
              )}
            </p>
            <Button onClick={handleImport} disabled={saving || matchedSelected.length === 0}>
              {saving ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Importando...</> : "Agregar a órdenes"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
