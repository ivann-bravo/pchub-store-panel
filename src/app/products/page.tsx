"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Search, ChevronLeft, ChevronRight, ArrowUpDown, Plus, ArrowUp, ArrowDown, Pencil, Package, Download, ChevronDown, EyeOff } from "lucide-react";
import { formatARS, formatClientPrice } from "@/lib/number-format";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

interface ProductWithPricing {
  id: number;
  woocommerceId: number | null;
  name: string;
  sku: string | null;
  eanUpc: string | null;
  category: string | null;
  brand: string | null;
  warranty: string | null;
  ivaRate: number;
  internalTaxRate: number;
  markupRegular: number;
  markupOffer: number | null;
  offerStart: string | null;
  offerEnd: string | null;
  ownPriceRegular: number | null;
  ownPriceOffer: number | null;
  localStock: number;
  hasSupplierStock: boolean;
  wooManualPrivate: boolean;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  imageUrl: string | null;
  slug: string | null;
  storeUrl: string | null;
  productTags: string | null;
  createdAt: string;
  updatedAt: string;
  bestSupplierCost: number | null;
  bestSupplierCode: string | null;
  bestSupplierName: string | null;
  bestSupplierStockQty: number;
  clientPrice: number | null;
  clientOfferPrice: number | null;
  displayPrice: number | null;
  isOnOffer: boolean;
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<ProductsLoadingSkeleton />}>
      <ProductsContent />
    </Suspense>
  );
}

function ProductsLoadingSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        breadcrumbs={[{ label: "Productos" }]}
      />
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-4 flex-wrap">
            <Skeleton className="h-10 flex-1 min-w-[300px]" />
            <Skeleton className="h-10 w-[200px]" />
            <Skeleton className="h-10 w-[200px]" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 p-4">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface FilterOptions {
  categories: string[];
  brands: string[];
  suppliers: { id: number; code: string; name: string }[];
}

function ProductsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";

  const [products, setProducts] = useState<ProductWithPricing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterOptions>({ categories: [], brands: [], suppliers: [] });

  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const search = searchParams.get("search") || "";
  const categoriesParam = searchParams.get("categories") || "";
  const brandsParam = searchParams.get("brands") || "";
  const suppliersParam = searchParams.get("suppliers") || "";
  const localStock = searchParams.get("localStock") || "";
  const wooManualPrivate = searchParams.get("wooManualPrivate") || "";
  const sortBy = searchParams.get("sortBy") || "name";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const selectedCategories = categoriesParam ? categoriesParam.split(",") : [];
  const selectedBrands = brandsParam ? brandsParam.split(",") : [];
  const selectedSuppliers = suppliersParam ? suppliersParam.split(",") : [];

  // Merge available options with currently selected values so selections
  // remain visible in the dropdown even when they fall outside the current context.
  const categoryOptions = useMemo(() => {
    const available = new Set(filters.categories);
    const all = [...filters.categories];
    for (const v of selectedCategories) {
      if (!available.has(v)) all.push(v);
    }
    return all.sort().map((c) => ({ value: c, label: c }));
  }, [filters.categories, selectedCategories]);

  const brandOptions = useMemo(() => {
    const available = new Set(filters.brands);
    const all = [...filters.brands];
    for (const v of selectedBrands) {
      if (!available.has(v)) all.push(v);
    }
    return all.sort().map((b) => ({ value: b, label: b }));
  }, [filters.brands, selectedBrands]);

  const supplierOptions = useMemo(() => {
    const available = new Set(filters.suppliers.map((s) => String(s.id)));
    const all = [...filters.suppliers];
    for (const v of selectedSuppliers) {
      if (!available.has(v)) {
        // Keep previously loaded supplier info if available
        const prev = all.find((s) => String(s.id) === v);
        if (!prev) all.push({ id: Number(v), code: v, name: v });
      }
    }
    return all.map((s) => ({ value: String(s.id), label: s.name }));
  }, [filters.suppliers, selectedSuppliers]);

  const [searchInput, setSearchInput] = useState(search);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkFields, setBulkFields] = useState<Record<string, { apply: boolean; value: string }>>({
    category: { apply: false, value: "" },
    brand: { apply: false, value: "" },
    markupRegular: { apply: false, value: "" },
    markupOffer: { apply: false, value: "" },
    ivaRate: { apply: false, value: "" },
    internalTaxRate: { apply: false, value: "" },
    localStock: { apply: false, value: "" },
  });

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === products.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(products.map((p) => p.id)));
    }
  };

  const handleBulkSave = async () => {
    const updates: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(bulkFields)) {
      if (field.apply && field.value !== "") {
        if (["markupRegular", "markupOffer", "ivaRate", "internalTaxRate"].includes(key)) {
          updates[key] = parseFloat(field.value);
        } else if (key === "localStock") {
          updates[key] = parseInt(field.value);
        } else {
          updates[key] = field.value;
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      toast.error("Selecciona al menos un campo para actualizar");
      return;
    }
    setBulkSaving(true);
    try {
      const res = await fetch("/api/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selected), updates }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${data.updated} productos actualizados`);
        setBulkDialogOpen(false);
        setSelected(new Set());
        fetchProducts();
      } else {
        toast.error(data.error || "Error al actualizar");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setBulkSaving(false);
    }
  };

  // Re-fetch available filter options whenever the active filters change.
  // Each dimension is computed without its own filter (cross-filtering pattern):
  // e.g. available categories are those that match current brands + suppliers + stock.
  useEffect(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (categoriesParam) params.set("categories", categoriesParam);
    if (brandsParam) params.set("brands", brandsParam);
    if (suppliersParam) params.set("suppliers", suppliersParam);
    if (localStock) params.set("localStock", localStock);
    if (wooManualPrivate) params.set("wooManualPrivate", wooManualPrivate);

    fetch(`/api/products/filters?${params}`)
      .then((r) => r.json())
      .then(setFilters)
      .catch(() => {});
  }, [search, categoriesParam, brandsParam, suppliersParam, localStock, wooManualPrivate]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      sortBy,
      sortOrder,
    });
    if (search) params.set("search", search);
    if (categoriesParam) params.set("categories", categoriesParam);
    if (brandsParam) params.set("brands", brandsParam);
    if (suppliersParam) params.set("suppliers", suppliersParam);
    if (localStock) params.set("localStock", localStock);
    if (wooManualPrivate) params.set("wooManualPrivate", wooManualPrivate);

    try {
      const res = await fetch(`/api/products?${params}`);
      const data = await res.json();
      setProducts(data.products || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error("Failed to fetch products", e);
    } finally {
      setLoading(false);
    }
  }, [page, limit, search, categoriesParam, brandsParam, suppliersParam, localStock, wooManualPrivate, sortBy, sortOrder]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const totalPages = Math.ceil(total / limit);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, val]) => {
      if (val) params.set(key, val);
      else params.delete(key);
    });
    router.push(`/products?${params}`);
  };

  const handleSearch = () => {
    updateParams({ search: searchInput, page: "1" });
  };

  const toggleSort = (column: string) => {
    if (sortBy === column) {
      updateParams({ sortOrder: sortOrder === "asc" ? "desc" : "asc" });
    } else {
      updateParams({ sortBy: column, sortOrder: "asc" });
    }
  };

  const SortIcon = ({ column }: { column: string }) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 opacity-50" />;
    return sortOrder === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        breadcrumbs={[{ label: "Productos" }]}
        actions={
          <div className="flex items-center gap-2">
            {!isViewer && selected.size > 0 && (
              <>
                <Badge variant="secondary">{selected.size} seleccionados</Badge>
                <Button variant="outline" onClick={() => setBulkDialogOpen(true)}>
                  <Pencil className="h-4 w-4 mr-2" /> Editar campos
                </Button>
              </>
            )}
            {!isViewer && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Exportar CSV
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={() => {
                      const params = new URLSearchParams();
                      if (search) params.set("search", search);
                      if (categoriesParam) params.set("categories", categoriesParam);
                      if (brandsParam) params.set("brands", brandsParam);
                      if (suppliersParam) params.set("suppliers", suppliersParam);
                      if (localStock) params.set("localStock", localStock);
                      const qs = params.toString();
                      window.location.href = `/api/products/export-csv${qs ? `?${qs}` : ""}`;
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    <div>
                      <div className="font-medium">Solo cambios</div>
                      <div className="text-xs text-muted-foreground">Solo productos con cambios desde el último export</div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      const params = new URLSearchParams({ full: "1" });
                      if (search) params.set("search", search);
                      if (categoriesParam) params.set("categories", categoriesParam);
                      if (brandsParam) params.set("brands", brandsParam);
                      if (suppliersParam) params.set("suppliers", suppliersParam);
                      if (localStock) params.set("localStock", localStock);
                      window.location.href = `/api/products/export-csv?${params}`;
                    }}
                  >
                    <Download className="h-4 w-4 mr-2 opacity-50" />
                    <div>
                      <div className="font-medium">Exportar todo</div>
                      <div className="text-xs text-muted-foreground">Todos los productos con ID de WooCommerce</div>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {!isViewer && (
              <Link href="/products/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" /> Nuevo Producto
                </Button>
              </Link>
            )}
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex gap-2 flex-1 min-w-[280px]">
              <Input
                placeholder="Buscar por nombre, SKU o EAN..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch} variant="secondary">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <MultiSelect
              options={categoryOptions}
              selected={selectedCategories}
              onChange={(vals) => updateParams({ categories: vals.join(","), page: "1" })}
              placeholder="Categoría"
              searchPlaceholder="Buscar categoría..."
              emptyText="Sin categorías"
              className="w-[200px]"
            />
            <MultiSelect
              options={brandOptions}
              selected={selectedBrands}
              onChange={(vals) => updateParams({ brands: vals.join(","), page: "1" })}
              placeholder="Marca"
              searchPlaceholder="Buscar marca..."
              emptyText="Sin marcas"
              className="w-[180px]"
            />
            <MultiSelect
              options={supplierOptions}
              selected={selectedSuppliers}
              onChange={(vals) => updateParams({ suppliers: vals.join(","), page: "1" })}
              placeholder="Proveedor"
              searchPlaceholder="Buscar proveedor..."
              emptyText="Sin proveedores"
              className="w-[180px]"
            />
            <Select
              value={localStock || "all"}
              onValueChange={(v) => updateParams({ localStock: v === "all" ? "" : v, page: "1" })}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Stock" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todo el stock</SelectItem>
                <SelectItem value="local">Stock propio</SelectItem>
                <SelectItem value="supplier">Stock proveedor</SelectItem>
                <SelectItem value="any">Propio + Proveedor</SelectItem>
                <SelectItem value="none">Sin stock</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={wooManualPrivate === "1" ? "default" : "outline"}
              size="sm"
              onClick={() => updateParams({ wooManualPrivate: wooManualPrivate === "1" ? "" : "1", page: "1" })}
              className={wooManualPrivate === "1" ? "bg-orange-500 hover:bg-orange-600 text-white border-orange-500" : ""}
              title="Filtrar productos pausados manualmente en tienda"
            >
              <EyeOff className="h-4 w-4 mr-1" />
              Pausados
            </Button>
            <Select
              value={limit.toString()}
              onValueChange={(v) => updateParams({ limit: v, page: "1" })}
            >
              <SelectTrigger className="w-[90px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <input
                    type="checkbox"
                    checked={products.length > 0 && selected.size === products.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </TableHead>
                <TableHead className="w-[60px]">ID</TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("name")}
                >
                  <div className="flex items-center gap-1">
                    Nombre
                    <SortIcon column="name" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("category")}
                >
                  <div className="flex items-center gap-1">
                    Categoría
                    <SortIcon column="category" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleSort("brand")}
                >
                  <div className="flex items-center gap-1">
                    Marca
                    <SortIcon column="brand" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 text-center"
                  onClick={() => toggleSort("localStock")}
                >
                  <div className="flex items-center justify-center gap-1">
                    Stock
                    <SortIcon column="localStock" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 text-center"
                  onClick={() => toggleSort("supplier")}
                >
                  <div className="flex items-center justify-center gap-1">
                    Proveedor
                    <SortIcon column="supplier" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => toggleSort("bestSupplierCost")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Costo ARS
                    <SortIcon column="bestSupplierCost" />
                  </div>
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50 text-right"
                  onClick={() => toggleSort("clientPrice")}
                >
                  <div className="flex items-center justify-end gap-1">
                    Precio Cliente
                    <SortIcon column="clientPrice" />
                  </div>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(9)].map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Package}
                      title="No se encontraron productos"
                      description="Intenta ajustar los filtros o agrega un nuevo producto."
                      action={
                        !isViewer ? (
                          <Link href="/products/new">
                            <Button>
                              <Plus className="h-4 w-4 mr-2" /> Nuevo Producto
                            </Button>
                          </Link>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product) => (
                  <TableRow
                    key={product.id}
                    className={`cursor-pointer hover:bg-muted/50 ${selected.has(product.id) ? "bg-blue-50 dark:bg-blue-950" : ""}`}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey) window.open(`/products/${product.id}`, "_blank");
                      else router.push(`/products/${product.id}`);
                    }}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {product.woocommerceId || product.id}
                    </TableCell>
                    <TableCell className="font-medium max-w-[300px]">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/products/${product.id}`}
                          className="truncate hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {product.name}
                        </Link>
                        {product.isOnOffer && (
                          <Badge variant="destructive" className="text-xs shrink-0">
                            Oferta
                          </Badge>
                        )}
                        {product.wooManualPrivate && (
                          <Badge className="text-xs shrink-0 bg-orange-500 text-white">
                            Pausado
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.category && (
                        <Badge variant="outline" className="text-xs">
                          {product.category}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{product.brand || "-"}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex flex-col items-center gap-1">
                        {product.localStock > 0 ? (
                          <Badge variant="default">{product.localStock}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">0</span>
                        )}
                        {product.bestSupplierStockQty > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            Prov: {product.bestSupplierStockQty}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      {product.ownPriceRegular ? (
                        <Badge variant="secondary" className="text-xs">
                          Propio
                        </Badge>
                      ) : product.bestSupplierName ? (
                        <Badge variant="outline" className="text-xs">
                          {product.bestSupplierName}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {product.bestSupplierCost ? formatARS(product.bestSupplierCost) : "-"}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${product.isOnOffer ? "text-orange-600" : "text-green-600"}`}>
                      {product.displayPrice ? formatClientPrice(product.displayPrice) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Mostrando {(page - 1) * limit + 1}-{Math.min(page * limit, total)} de{" "}
          {total.toLocaleString()} productos
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => updateParams({ page: String(page - 1) })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          {(() => {
            const pages: (number | string)[] = [];
            const showPages = 5;
            let start = Math.max(1, page - Math.floor(showPages / 2));
            const end = Math.min(totalPages, start + showPages - 1);
            if (end - start < showPages - 1) {
              start = Math.max(1, end - showPages + 1);
            }
            if (start > 1) {
              pages.push(1);
              if (start > 2) pages.push("...");
            }
            for (let i = start; i <= end; i++) {
              pages.push(i);
            }
            if (end < totalPages) {
              if (end < totalPages - 1) pages.push("...");
              pages.push(totalPages);
            }
            return pages.map((p, idx) =>
              typeof p === "number" ? (
                <Button
                  key={idx}
                  variant={p === page ? "default" : "outline"}
                  size="sm"
                  className="w-9"
                  onClick={() => updateParams({ page: String(p) })}
                >
                  {p}
                </Button>
              ) : (
                <span key={idx} className="px-2 text-muted-foreground">
                  {p}
                </span>
              )
            );
          })()}
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Bulk Edit Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Editar {selected.size} productos</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {[
              { key: "category", label: "Categoría", type: "text" },
              { key: "brand", label: "Marca", type: "text" },
              { key: "markupRegular", label: "Markup Regular", type: "number" },
              { key: "markupOffer", label: "Markup Oferta", type: "number" },
              { key: "ivaRate", label: "IVA", type: "number" },
              { key: "internalTaxRate", label: "Imp. Internos", type: "number" },
              { key: "localStock", label: "Stock Local", type: "number" },
            ].map(({ key, label, type }) => (
              <div key={key} className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={bulkFields[key].apply}
                  onChange={(e) =>
                    setBulkFields((prev) => ({
                      ...prev,
                      [key]: { ...prev[key], apply: e.target.checked },
                    }))
                  }
                  className="h-4 w-4 rounded border-gray-300"
                />
                <Label className="w-28 text-sm">{label}</Label>
                <Input
                  type={type}
                  step={type === "number" ? "0.01" : undefined}
                  value={bulkFields[key].value}
                  onChange={(e) =>
                    setBulkFields((prev) => ({
                      ...prev,
                      [key]: { ...prev[key], value: e.target.value },
                    }))
                  }
                  disabled={!bulkFields[key].apply}
                  className="flex-1"
                />
              </div>
            ))}
            <Button
              onClick={handleBulkSave}
              disabled={bulkSaving}
              className="w-full mt-4"
            >
              {bulkSaving ? "Guardando..." : "Aplicar cambios"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
