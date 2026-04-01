"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "@/components/layout/page-header";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Layers,
  Plus,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  ExternalLink,
  Search,
  ChevronDown,
  ChevronUp,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import type { ComboTemplateWithSlots, RefreshAllResult } from "@/types";

interface PctryProduct {
  id: number;
  name: string;
  sku: string;
  woocommerceId: number | null;
  ownPriceRegular: number | null;
  hasSupplierStock: boolean;
}

export default function CombosPage() {
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [combos, setCombos] = useState<ComboTemplateWithSlots[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshResult, setLastRefreshResult] = useState<RefreshAllResult | null>(null);

  // Auto-link by SKU
  const [autoLinking, setAutoLinking] = useState(false);

  const handleAutoLinkBySku = async () => {
    setAutoLinking(true);
    try {
      const res = await fetch("/api/combos/auto-link-by-sku", { method: "POST" });
      const data = await res.json();
      if (data.linked > 0) {
        toast.success(`${data.linked} combo${data.linked !== 1 ? "s" : ""} vinculado${data.linked !== 1 ? "s" : ""} al producto por SKU`);
        fetchCombos();
      } else {
        toast.info("No se encontraron templates sin vincular con SKU coincidente");
      }
    } catch {
      toast.error("Error al vincular por SKU");
    } finally {
      setAutoLinking(false);
    }
  };

  // PCTRY detection
  const [pctryOpen, setPctryOpen] = useState(false);
  const [pctryProducts, setPctryProducts] = useState<PctryProduct[]>([]);
  const [pctryTotal, setPctryTotal] = useState(0);
  const [pctryLoading, setPctryLoading] = useState(false);
  const [selectedPctry, setSelectedPctry] = useState<Set<number>>(new Set());
  const [bulkCreating, setBulkCreating] = useState(false);

  const fetchCombos = useCallback(async () => {
    try {
      const res = await fetch("/api/combos");
      const data = await res.json();
      setCombos(data);
    } catch {
      toast.error("Error al cargar combos");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCombos();
  }, [fetchCombos]);

  const handleRefreshAll = async () => {
    setRefreshing(true);
    setLastRefreshResult(null);
    try {
      const res = await fetch("/api/combos/refresh-all", { method: "POST" });
      const data: RefreshAllResult = await res.json();
      setLastRefreshResult(data);
      const ok = data.results.filter((r) => r.success).length;
      const fail = data.results.filter((r) => !r.success).length;
      if (fail === 0) {
        toast.success(`${ok} combo${ok !== 1 ? "s" : ""} actualizados`);
      } else {
        toast.warning(`${ok} OK, ${fail} con errores`);
      }
      fetchCombos();
    } catch {
      toast.error("Error al actualizar combos");
    } finally {
      setRefreshing(false);
    }
  };

  const loadPctry = async () => {
    setPctryLoading(true);
    try {
      const res = await fetch("/api/combos/detect-pctry");
      const data = await res.json();
      setPctryProducts(data.products ?? []);
      setPctryTotal(data.total ?? 0);
      setSelectedPctry(new Set(data.products.map((p: PctryProduct) => p.id)));
    } catch {
      toast.error("Error al detectar productos PCTRY");
    } finally {
      setPctryLoading(false);
    }
  };

  const handleTogglePctryOpen = async () => {
    if (!pctryOpen && pctryProducts.length === 0) {
      await loadPctry();
    }
    setPctryOpen((v) => !v);
  };

  const toggleSelectPctry = (id: number) => {
    setSelectedPctry((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedPctry.size === pctryProducts.length) {
      setSelectedPctry(new Set());
    } else {
      setSelectedPctry(new Set(pctryProducts.map((p) => p.id)));
    }
  };

  const handleBulkCreate = async () => {
    if (selectedPctry.size === 0) return;
    setBulkCreating(true);
    try {
      const res = await fetch("/api/combos/bulk-create-from-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: Array.from(selectedPctry) }),
      });
      const data = await res.json();
      if (data.created > 0) {
        toast.success(`${data.created} template${data.created !== 1 ? "s" : ""} creado${data.created !== 1 ? "s" : ""}`);
        if (data.skipped > 0) {
          toast.info(`${data.skipped} omitido${data.skipped !== 1 ? "s" : ""} (ya existían o sin SKU)`);
        }
        await fetchCombos();
        await loadPctry();
      } else {
        toast.warning("No se crearon templates (ya existían o sin SKU)");
      }
    } catch {
      toast.error("Error al crear templates");
    } finally {
      setBulkCreating(false);
    }
  };

  // Search / filter
  const [searchInput, setSearchInput] = useState("");
  const [stockFilter, setStockFilter] = useState<"all" | "stock" | "nostock">("all");

  const filteredCombos = combos.filter((c) => {
    const q = searchInput.toLowerCase();
    const matchesSearch = !q || c.name.toLowerCase().includes(q) || (c.sku ?? "").toLowerCase().includes(q);
    const matchesStock =
      stockFilter === "all" ||
      (stockFilter === "stock" && c.lastHasStock === true) ||
      (stockFilter === "nostock" && c.lastHasStock !== true);
    return matchesSearch && matchesStock;
  });

  // Stats (always over all combos, not filtered)
  const total = combos.length;
  const withStock = combos.filter((c) => c.lastHasStock === true).length;
  const withoutPrice = combos.filter((c) => c.lastTotalPrice === null).length;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded w-40" />
        <div className="h-48 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Combos y PCs"
        breadcrumbs={[{ label: "Catálogo" }, { label: "Combos y PCs" }]}
        description="Armado automático desde los componentes más económicos en stock"
        actions={
          <div className="flex gap-2">
            <Link href="/combos/buscador">
              <Button variant="outline">
                <Search className="h-4 w-4 mr-2" /> Buscador
              </Button>
            </Link>
            {!isViewer && (
              <Button
                variant="outline"
                onClick={handleAutoLinkBySku}
                disabled={autoLinking}
                title="Vincula automáticamente los combo templates al producto con el mismo SKU"
              >
                {autoLinking ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Vincular por SKU
              </Button>
            )}
            {!isViewer && (
              <Button
                variant="outline"
                onClick={handleRefreshAll}
                disabled={refreshing || total === 0}
              >
                {refreshing ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                {refreshing ? "Actualizando..." : "Actualizar Todos"}
              </Button>
            )}
            {!isViewer && (
              <Link href="/combos/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> Nuevo Combo
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Total combos</p>
            <p className="text-3xl font-bold">{total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Con stock completo</p>
            <p className="text-3xl font-bold text-green-600">{withStock}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Sin precio</p>
            <p className="text-3xl font-bold text-orange-600">{withoutPrice}</p>
          </CardContent>
        </Card>
      </div>

      {/* Refresh result summary */}
      {lastRefreshResult && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800">
          <CardHeader>
            <CardTitle className="text-sm">Resultado de actualización</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm">
              {lastRefreshResult.results.map((r) => (
                <div key={r.templateId} className="flex items-center gap-2">
                  {r.success ? (
                    <CheckCircle className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                  )}
                  <span className="font-mono font-medium">{r.templateSku}</span>
                  {r.success && r.totalPrice != null && (
                    <span className="text-muted-foreground">
                      → ${r.totalPrice.toLocaleString("es-AR")}
                      {r.hasStock ? (
                        <span className="ml-1 text-green-600">● stock</span>
                      ) : (
                        <span className="ml-1 text-red-500">● sin stock</span>
                      )}
                    </span>
                  )}
                  {r.success && r.totalPrice == null && (
                    <span className="text-orange-600">sin precio (slots sin resolver)</span>
                  )}
                  {!r.success && (
                    <span className="text-red-600">{r.error}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Combos table */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>Combos configurados</CardTitle>
              <CardDescription className="mt-1">
                Cada combo busca automáticamente el componente más barato en stock según los filtros de cada slot.
              </CardDescription>
            </div>
            {combos.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Buscar por nombre o SKU..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="pl-8 h-8 w-[220px] text-sm"
                  />
                </div>
                <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as typeof stockFilter)}>
                  <SelectTrigger className="h-8 w-[130px] text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todo</SelectItem>
                    <SelectItem value="stock">Con stock</SelectItem>
                    <SelectItem value="nostock">Sin stock</SelectItem>
                  </SelectContent>
                </Select>
                {(searchInput || stockFilter !== "all") && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {filteredCombos.length} de {total}
                  </span>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {combos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No hay combos configurados</p>
              <p className="text-sm mt-1">Creá el primero con el botón &quot;Nuevo Combo&quot;</p>
            </div>
          ) : filteredCombos.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-10 w-10 mx-auto mb-3 opacity-25" />
              <p className="font-medium">Sin resultados</p>
              <p className="text-sm mt-1">Probá con otro nombre, SKU o filtro de stock.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="text-center">Slots</TableHead>
                  <TableHead className="text-right">Precio Total</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead>Última actualización</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCombos.map((combo) => (
                  <TableRow key={combo.id}>
                    <TableCell>
                      <span className="font-mono font-medium text-sm">{combo.sku}</span>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{combo.name}</p>
                        {combo.notes && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {combo.notes}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-sm font-medium">{combo.slots.length}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      {combo.lastTotalPrice != null ? (
                        <span className="font-medium">
                          ${combo.lastTotalPrice.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {combo.lastRefreshedAt == null ? (
                        <Badge variant="secondary">Sin calcular</Badge>
                      ) : combo.lastHasStock ? (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle className="h-3 w-3" /> Stock
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <AlertCircle className="h-3 w-3" /> Sin stock
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {combo.lastRefreshedAt ? (
                        <span className="text-xs text-muted-foreground">
                          {new Date(combo.lastRefreshedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nunca</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/combos/${combo.id}`}>
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" /> Ver
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      {/* PCTRY Detection */}
      {!isViewer && <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={handleTogglePctryOpen}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">
                Productos PCTRY sin combo configurado
                {pctryProducts.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    ({pctryProducts.length} sin combo · {pctryTotal} totales)
                  </span>
                )}
              </CardTitle>
            </div>
            {pctryOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <CardDescription className="text-xs">
            Detecta automáticamente los productos PCTRY que no tienen template de combo vinculado.
          </CardDescription>
        </CardHeader>

        {pctryOpen && (
          <CardContent>
            {pctryLoading ? (
              <div className="py-6 text-center text-muted-foreground text-sm">Detectando productos PCTRY...</div>
            ) : pctryProducts.length === 0 ? (
              <div className="py-6 text-center text-muted-foreground text-sm">
                Todos los productos PCTRY ya tienen combo configurado.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={toggleSelectAll}>
                    {selectedPctry.size === pctryProducts.length ? "Deseleccionar todos" : "Seleccionar todos"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleBulkCreate}
                    disabled={bulkCreating || selectedPctry.size === 0}
                  >
                    {bulkCreating ? (
                      <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 mr-2" />
                    )}
                    Crear {selectedPctry.size > 0 ? selectedPctry.size : ""} template{selectedPctry.size !== 1 ? "s" : ""} vacíos
                  </Button>
                </div>

                <div className="border rounded-md divide-y max-h-80 overflow-y-auto">
                  {pctryProducts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer"
                      onClick={() => toggleSelectPctry(p.id)}
                    >
                      <input
                        type="checkbox"
                        checked={selectedPctry.has(p.id)}
                        onChange={() => toggleSelectPctry(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-primary cursor-pointer"
                      />
                      <span className="font-mono text-xs text-muted-foreground w-24 shrink-0">{p.sku}</span>
                      <span className="text-sm flex-1 truncate">{p.name}</span>
                      {p.ownPriceRegular != null && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          ${Math.round(p.ownPriceRegular).toLocaleString("es-AR")}
                        </span>
                      )}
                      <span className={`text-xs shrink-0 ${p.hasSupplierStock ? "text-green-600" : "text-muted-foreground"}`}>
                        {p.hasSupplierStock ? "● stock" : "○ sin stock"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>}
    </div>
  );
}
