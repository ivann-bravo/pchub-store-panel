"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Link2, Unlink2, Search, ChevronLeft, ChevronRight, Wand2, ArrowUpDown, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";

interface CatalogItem {
  id: number;
  catalogId: number;
  supplierCode: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  stockAvailable: boolean | null;
  rawData: string | null;
  linkedProductId: number | null;
  matchConfidence: number | null;
  linkedProduct: { id: number; name: string; sku: string | null } | null;
  supplierStockQty: number | null; // real stock from productSupplierLinks (updated by API sync)
}

interface SearchResult {
  id: number;
  name: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
}

interface SupplierInfo {
  id: number;
  code: string;
  name: string;
  currency: string;
  taxRate: number; // IIBB rate
}

interface ExchangeRateData {
  sellRate: number;
}

// Parse rawData to get extra fields
function parseRawData(rawData: string | null): Record<string, unknown> {
  if (!rawData) return {};
  try {
    return JSON.parse(rawData);
  } catch {
    return {};
  }
}

/**
 * Find a value in rawData by trying multiple keys (handles BOM-corrupted keys)
 */
function findInRaw(rawData: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (rawData[key] !== undefined && rawData[key] !== null) return rawData[key];
  }
  // Try partial match (for BOM-corrupted keys like "ï»¿Codigo")
  const rawKeys = Object.keys(rawData);
  for (const searchKey of keys) {
    if (!searchKey) continue;
    const lower = searchKey.toLowerCase();
    for (const rk of rawKeys) {
      if (rk.toLowerCase().includes(lower) || rk.toLowerCase().endsWith(lower)) {
        if (rawData[rk] !== undefined && rawData[rk] !== null) return rawData[rk];
      }
    }
  }
  return undefined;
}

// Get supplier code from rawData (for BOM-corrupted imports)
function getSupplierCode(rawData: Record<string, unknown>): string | null {
  const val = findInRaw(rawData, ['Codigo', 'Código', 'codigo']);
  return val ? String(val) : null;
}

// Get price from rawData (for when price field is null in DB)
function getPrice(rawData: Record<string, unknown>): number | null {
  // Try structured format first (from AIR connector)
  // Then try raw CSV format (empty key for unnamed column, or common names)
  const val = findInRaw(rawData, ['', 'Precio USD', 'Precio', 'precio', '__col_2__']);
  if (val === undefined || val === null) return null;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) ? null : num;
}

// Get primary stock quantity from rawData
// GN: stock.caba (deposito CABA), AIR: stock.lug (deposito LUG), Polytech: stockQty
function getStockQuantity(item: CatalogItem): number | null {
  const rawData = parseRawData(item.rawData);

  // For linked products, prefer real API stock from productSupplierLinks
  if (item.linkedProductId !== null && item.supplierStockQty !== null) {
    return item.supplierStockQty;
  }

  // Structured format: stock.caba (GN) or stock.lug (AIR)
  if (rawData.stock && typeof rawData.stock === 'object') {
    const stock = rawData.stock as Record<string, number>;
    // NB: single depot
    if ('nb' in stock) return stock.nb;
    // Elit: total stock
    if ('elit' in stock) return stock.elit;
    // GN: primary depot is CABA
    if ('caba' in stock) return stock.caba;
    // AIR: primary depot is LUG
    if ('lug' in stock) return stock.lug;
    const values = Object.values(stock).filter(v => typeof v === 'number');
    if (values.length > 0) return values.reduce((a, b) => a + b, 0);
  }
  // Polytech Excel format: stockQty directly
  if (typeof rawData.stockQty === 'number') return rawData.stockQty;
  // Raw CSV format (LUG column directly)
  const lugVal = findInRaw(rawData, ['LUG', 'lug']);
  if (lugVal !== undefined) {
    const num = parseInt(String(lugVal));
    return isNaN(num) ? null : num;
  }
  return null;
}

// Get secondary stock depots (for tooltip/extra info)
function getSecondaryStock(rawData: Record<string, unknown>): Record<string, number> | null {
  if (rawData.stock && typeof rawData.stock === 'object') {
    const stock = rawData.stock as Record<string, number>;
    // GN: secondary depot is MDP
    if ('mdp' in stock && stock.mdp > 0) return { mdp: stock.mdp };
    // AIR: secondary depots are ROS, MZA, CBA
    const secondary: Record<string, number> = {};
    for (const [key, val] of Object.entries(stock)) {
      if (key !== 'lug' && key !== 'caba' && typeof val === 'number' && val > 0) {
        secondary[key] = val;
      }
    }
    return Object.keys(secondary).length > 0 ? secondary : null;
  }
  return null;
}

// Get SKU from rawData
function getSku(rawData: Record<string, unknown>): string | null {
  const val = findInRaw(rawData, ['sku', 'Part Number', 'part number', 'SKU', 'PartNumber']);
  return val ? String(val) : null;
}

// Get IVA rate from rawData (default 0.21)
function getIvaRate(rawData: Record<string, unknown>): number {
  // Structured format: ivaRate as decimal (0.21)
  if (typeof rawData.ivaRate === 'number') return rawData.ivaRate;
  // Raw CSV format: IVA as percentage (21 or 10.5)
  const ivaVal = findInRaw(rawData, ['IVA', 'iva']);
  if (ivaVal !== undefined) {
    const num = parseFloat(String(ivaVal));
    if (!isNaN(num)) {
      // If > 1, it's a percentage (21 or 10.5) -> convert to decimal
      return num > 1 ? num / 100 : num;
    }
  }
  return 0.21;
}

// Get internal tax rate from rawData (default 0)
function getInternalTaxRate(rawData: Record<string, unknown>): number {
  if (typeof rawData.internalTaxRate === 'number') return rawData.internalTaxRate;
  return 0;
}

// Calculate final price in ARS using the full formula
// Formula: priceUSD * (1 + IVA + IIBB + ImpInt) * exchangeRate
function calculatePriceARS(
  priceUSD: number,
  ivaRate: number,
  iibbRate: number,
  internalTaxRate: number,
  exchangeRate: number
): number {
  return priceUSD * (1 + ivaRate + iibbRate + internalTaxRate) * exchangeRate;
}

export default function CatalogPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [catalogs, setCatalogs] = useState<{ id: number; filename: string; importedAt: string }[]>([]);
  const [selectedCatalog, setSelectedCatalog] = useState<string>("");
  const [supplier, setSupplier] = useState<SupplierInfo | null>(null);
  const [exchangeRate, setExchangeRate] = useState<number>(1);

  // Search, sort, stock filter
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [stockFilter, setStockFilter] = useState("");

  // Linking dialog state
  const [, setLinkingItem] = useState<CatalogItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Unlink confirmation dialog state
  const [unlinkTarget, setUnlinkTarget] = useState<{ itemId: number; code: string | null; description: string | null } | null>(null);
  const [unlinking, setUnlinking] = useState(false);

  // Fetch exchange rate
  useEffect(() => {
    fetch("/api/exchange-rate")
      .then(r => r.json())
      .then((data: ExchangeRateData) => {
        if (data.sellRate) setExchangeRate(data.sellRate);
      })
      .catch(() => {});
  }, []);

  // Fetch supplier info
  useEffect(() => {
    fetch(`/api/suppliers/${params.id}`)
      .then(r => r.json())
      .then(data => setSupplier(data))
      .catch(() => {});
  }, [params.id]);

  const fetchItems = async () => {
    setLoading(true);
    const queryParams = new URLSearchParams({
      page: String(page),
      limit: "50",
      status,
    });
    if (selectedCatalog) queryParams.set("catalogId", selectedCatalog);
    if (searchTerm) queryParams.set("search", searchTerm);
    if (sortBy) queryParams.set("sortBy", sortBy);
    if (sortBy) queryParams.set("sortOrder", sortOrder);
    if (stockFilter) queryParams.set("stockFilter", stockFilter);

    try {
      const res = await fetch(`/api/suppliers/${params.id}/catalog?${queryParams}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setCatalogs(data.catalogs || []);
      if (!selectedCatalog && data.currentCatalogId) {
        setSelectedCatalog(String(data.currentCatalogId));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, page, status, selectedCatalog, searchTerm, sortBy, sortOrder, stockFilter]);

  const searchProducts = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await res.json();
      setSearchResults(data.products || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const confirmUnlink = async () => {
    if (!unlinkTarget) return;
    setUnlinking(true);
    try {
      const res = await fetch(`/api/suppliers/${params.id}/catalog`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: unlinkTarget.itemId }),
      });
      if (res.ok) {
        toast.success("Producto desvinculado");
        setUnlinkTarget(null);
        fetchItems();
      } else {
        toast.error("Error al desvincular");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setUnlinking(false);
    }
  };

  const linkProduct = async (itemId: number, productId: number) => {
    try {
      const res = await fetch(`/api/suppliers/${params.id}/catalog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, productId }),
      });
      if (res.ok) {
        toast.success("Producto vinculado");
        setLinkingItem(null);
        fetchItems();
      } else {
        toast.error("Error al vincular");
      }
    } catch {
      toast.error("Error de conexión");
    }
  };

  const [searchInput, setSearchInput] = useState("");

  const handleSearch = () => {
    setSearchTerm(searchInput);
    setPage(1);
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const totalPages = Math.ceil(total / 50);
  // Show USD columns if supplier is USD or any items are USD (GN items are USD regardless of supplier config)
  const hasUSDItems = supplier?.currency === "USD" || items.some(i => i.currency === "USD");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <h1 className="text-2xl font-bold">
          Catálogo {supplier?.code || ""}
        </h1>
        {hasUSDItems && (
          <Badge variant="outline">
            Dólar: {formatARS(exchangeRate)}
          </Badge>
        )}
        <div className="flex-1" />
        {!isViewer && (
          <Button
            onClick={() => router.push(`/suppliers/${params.id}/catalog/match`)}
          >
            <Wand2 className="h-4 w-4 mr-2" />
            Vincular Productos
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-4 flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[250px]">
              <Input
                placeholder="Buscar por código, descripción..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} variant="secondary">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <Select value={selectedCatalog} onValueChange={(v) => { setSelectedCatalog(v); setPage(1); }}>
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Seleccionar importación" />
              </SelectTrigger>
              <SelectContent>
                {catalogs.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.filename} - {new Date(c.importedAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="linked">Vinculados</SelectItem>
                <SelectItem value="unlinked">Sin vincular</SelectItem>
              </SelectContent>
            </Select>
            <Select value={stockFilter || "all"} onValueChange={(v) => { setStockFilter(v === "all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo stock</SelectItem>
                <SelectItem value="inStock">Con stock</SelectItem>
                <SelectItem value="noStock">Sin stock</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="outline" className="self-center">
              {total.toLocaleString()} items
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("supplierCode")}
                >
                  <div className="flex items-center gap-1">
                    Código <SortIcon column="supplierCode" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("description")}
                >
                  <div className="flex items-center gap-1">
                    Descripción <SortIcon column="description" />
                  </div>
                </TableHead>
                <TableHead>SKU</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => toggleSort("price")}
                >
                  <div className="flex items-center justify-end gap-1">
                    USD (s/IVA) <SortIcon column="price" />
                  </div>
                </TableHead>
                <TableHead className="text-right">ARS (Final)</TableHead>
                <TableHead className="text-center">Stock</TableHead>
                <TableHead>Producto Vinculado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(8)].map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-muted animate-pulse rounded w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No hay items en este catálogo
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => {
                  const rawData = parseRawData(item.rawData);
                  const stockQty = getStockQuantity(item);
                  const secondaryStock = getSecondaryStock(rawData);
                  const sku = getSku(rawData);
                  const ivaRate = getIvaRate(rawData);
                  const internalTaxRate = getInternalTaxRate(rawData);
                  const iibbRate = supplier?.taxRate ?? 0;

                  // Use DB price, or extract from rawData if DB price is null (BOM-corrupted import)
                  const priceUsd = item.price ?? getPrice(rawData);
                  // Use DB supplierCode, or extract from rawData
                  const code = item.supplierCode || getSupplierCode(rawData);

                  // Check item currency (not supplier currency — GN items are USD even if supplier is ARS)
                  const itemIsUSD = (item.currency || supplier?.currency) === "USD";

                  // Calculate price using full formula: USD * (1 + IVA + IIBB + ImpInt) * Dólar
                  const priceArs = priceUsd && itemIsUSD
                    ? calculatePriceARS(priceUsd, ivaRate, iibbRate, internalTaxRate, exchangeRate)
                    : priceUsd;

                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">
                        {code || "-"}
                      </TableCell>
                      <TableCell className="max-w-[250px] truncate text-sm">
                        {item.description || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {sku || "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {priceUsd ? `$${priceUsd.toFixed(2)}` : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {priceArs ? formatARS(priceArs) : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {stockQty !== null ? (
                          <div className="flex items-center justify-center gap-1">
                            <Badge
                              variant={stockQty > 0 ? "default" : "secondary"}
                              title={item.linkedProductId !== null && item.supplierStockQty !== null ? "Stock real (API)" : "Stock del catálogo"}
                            >
                              {stockQty}
                            </Badge>
                            {secondaryStock && (
                              <span className="text-[10px] text-muted-foreground">
                                ({Object.entries(secondaryStock).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(", ")})
                              </span>
                            )}
                          </div>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                      <TableCell>
                        {item.linkedProduct ? (
                          <Link
                            href={`/products/${item.linkedProduct!.id}`}
                            className="text-primary hover:underline text-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.linkedProduct.name.substring(0, 40)}
                            {item.linkedProduct.name.length > 40 ? "..." : ""}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground text-xs">Sin vincular</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.linkedProductId && !isViewer ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive border-destructive/30 hover:border-destructive"
                            onClick={() => setUnlinkTarget({ itemId: item.id, code: item.supplierCode, description: item.description })}
                          >
                            <Unlink2 className="h-3 w-3 mr-1" /> Desvincular
                          </Button>
                        ) : !item.linkedProductId && !isViewer && (
                          <div className="flex gap-1 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const qp = new URLSearchParams();
                                if (item.description) qp.set("name", item.description);
                                const sk = getSku(parseRawData(item.rawData));
                                if (sk) qp.set("sku", sk);
                                qp.set("catalogItemId", String(item.id));
                                qp.set("supplierId", String(params.id));
                                router.push(`/products/new?${qp}`);
                              }}
                            >
                              <Plus className="h-3 w-3 mr-1" /> Crear
                            </Button>
                            <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setLinkingItem(item);
                                  setSearchQuery(item.description || item.supplierCode || "");
                                  setSearchResults([]);
                                }}
                              >
                                <Link2 className="h-3 w-3 mr-1" /> Vincular
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                              <DialogHeader>
                                <DialogTitle>Vincular Producto</DialogTitle>
                              </DialogHeader>
                              <div className="space-y-4">
                                <div className="bg-muted p-3 rounded text-sm space-y-1">
                                  <p><strong>Código:</strong> {code || "-"}</p>
                                  <p><strong>Descripción:</strong> {item.description}</p>
                                  <p><strong>SKU:</strong> {sku || "-"}</p>
                                  <p><strong>Precio USD (s/IVA):</strong> {priceUsd ? `$${priceUsd.toFixed(2)}` : "-"}</p>
                                  <p><strong>IVA:</strong> {(ivaRate * 100).toFixed(1)}%</p>
                                  {internalTaxRate > 0 && <p><strong>Imp. Internos:</strong> {(internalTaxRate * 100).toFixed(1)}%</p>}
                                  {iibbRate > 0 && <p><strong>IIBB:</strong> {(iibbRate * 100).toFixed(1)}%</p>}
                                  <p><strong>Precio ARS (final):</strong> {priceArs ? formatARS(priceArs) : "-"}</p>
                                  <p><strong>Stock:</strong> {stockQty ?? "-"}{secondaryStock ? ` (${Object.entries(secondaryStock).map(([k, v]) => `${k.toUpperCase()}: ${v}`).join(", ")})` : ""}</p>
                                </div>
                                <div className="flex gap-2">
                                  <Input
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar producto por nombre o SKU..."
                                    onKeyDown={(e) => e.key === "Enter" && searchProducts()}
                                  />
                                  <Button onClick={searchProducts} disabled={searching}>
                                    <Search className="h-4 w-4" />
                                  </Button>
                                </div>
                                {searchResults.length > 0 && (
                                  <div className="border rounded max-h-[300px] overflow-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Nombre</TableHead>
                                          <TableHead>SKU</TableHead>
                                          <TableHead>Marca</TableHead>
                                          <TableHead></TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {searchResults.map((p) => (
                                          <TableRow key={p.id}>
                                            <TableCell className="text-sm">{p.name}</TableCell>
                                            <TableCell className="font-mono text-xs">{p.sku || "-"}</TableCell>
                                            <TableCell className="text-sm">{p.brand || "-"}</TableCell>
                                            <TableCell>
                                              <Button
                                                size="sm"
                                                onClick={() => linkProduct(item.id, p.id)}
                                              >
                                                Vincular
                                              </Button>
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                )}
                              </div>
                            </DialogContent>
                          </Dialog>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Unlink confirmation dialog */}
      <Dialog open={!!unlinkTarget} onOpenChange={(open) => { if (!open) setUnlinkTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Desvincular producto</DialogTitle>
            <DialogDescription>
              ¿Confirmás que querés desvincular este ítem del proveedor?
            </DialogDescription>
          </DialogHeader>
          {unlinkTarget && (
            <div className="bg-muted rounded p-3 text-sm space-y-1">
              {unlinkTarget.code && <p><strong>Código:</strong> {unlinkTarget.code}</p>}
              {unlinkTarget.description && <p><strong>Descripción:</strong> {unlinkTarget.description}</p>}
              <p className="text-muted-foreground text-xs pt-1">
                Se eliminará el precio actual. El historial de precios se conserva.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkTarget(null)} disabled={unlinking}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmUnlink} disabled={unlinking}>
              {unlinking ? "Desvinculando..." : "Desvincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
