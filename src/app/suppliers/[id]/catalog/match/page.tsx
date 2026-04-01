"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { ArrowLeft, Link2, ChevronLeft, ChevronRight, X, Loader2, Plus, Search } from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";

interface MatchItem {
  catalogItemId: number;
  supplierCode: string;
  supplierDescription: string;
  supplierSku: string | null;
  supplierPriceUsd: number;
  supplierPriceArs: number;
  stockLug: number | null;
  bestMatch: {
    productId: number;
    productName: string;
    productSku: string | null;
    productPrice: number | null;
    confidence: number;
    matchType: string;
  } | null;
}

function confidenceBadge(confidence: number) {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.9) {
    return <Badge className="bg-green-600 hover:bg-green-700 text-white">{pct}%</Badge>;
  }
  if (confidence >= 0.7) {
    return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-white">{pct}%</Badge>;
  }
  if (confidence >= 0.5) {
    return <Badge className="bg-red-500 hover:bg-red-600 text-white">{pct}%</Badge>;
  }
  return <Badge variant="secondary">{pct}%</Badge>;
}

export default function MatchPage() {
  const params = useParams();
  const router = useRouter();
  const supplierId = params.id as string;
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace(`/suppliers/${supplierId}/catalog`);
    }
  }, [session, status, router, supplierId]);

  const [items, setItems] = useState<MatchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [linking, setLinking] = useState(false);

  // Selection state
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Dismissed items (hidden from view)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  // Manual link state (for "Sin match" items)
  const [linkingItemId, setLinkingItemId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<{ id: number; name: string; sku: string | null }[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  // Search + server-side filters
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [minScore, setMinScore] = useState("all");
  const [matchType, setMatchType] = useState("all");

  // Debounced product search for manual linking
  useEffect(() => {
    if (!linkSearch.trim()) {
      setLinkResults([]);
      return;
    }
    setLinkLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/products?search=${encodeURIComponent(linkSearch)}&limit=8`
        );
        const data = await res.json();
        setLinkResults(data.products ?? []);
      } catch {
        setLinkResults([]);
      } finally {
        setLinkLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [linkSearch]);

  const handleManualLink = async (catalogItemId: number, productId: number) => {
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/catalog/bulk-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links: [{ catalogItemId, productId }] }),
      });
      const data = await res.json();
      if (data.linked > 0) {
        toast.success("Producto vinculado");
        setLinkingItemId(null);
        setLinkSearch("");
        setLinkResults([]);
        fetchMatches();
      } else if (data.errors?.length) {
        toast.error(data.errors[0]);
      }
    } catch {
      toast.error("Error al vincular");
    }
  };

  const fetchMatches = useCallback(async () => {
    setLoading(true);
    try {
      const bodyParams: Record<string, unknown> = { page, limit: 50 };
      if (search) bodyParams.search = search;
      if (minScore !== "all") bodyParams.minScore = parseFloat(minScore);
      if (matchType !== "all") bodyParams.matchType = matchType;

      const res = await fetch(`/api/suppliers/${supplierId}/catalog/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyParams),
      });
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 0);
      setSelected(new Set());
      setDismissed(new Set());
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar matches");
    } finally {
      setLoading(false);
    }
  }, [supplierId, page, search, minScore, matchType]);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  // Only filter dismissed client-side
  const visibleItems = items.filter((item) => !dismissed.has(item.catalogItemId));

  // Items with a match that can be selected
  const selectableItems = visibleItems.filter((item) => item.bestMatch !== null);

  const toggleSelect = (catalogItemId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(catalogItemId)) {
        next.delete(catalogItemId);
      } else {
        next.add(catalogItemId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === selectableItems.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectableItems.map((item) => item.catalogItemId)));
    }
  };

  const dismissItem = async (catalogItemId: number, supplierCode: string, dismissType: "match" | "create") => {
    // Optimistic UI update
    setDismissed((prev) => new Set(prev).add(catalogItemId));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(catalogItemId);
      return next;
    });

    try {
      await fetch(`/api/suppliers/${supplierId}/catalog/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierCode, dismissType }),
      });
    } catch {
      toast.error("Error al descartar");
      // Revert optimistic update
      setDismissed((prev) => {
        const next = new Set(prev);
        next.delete(catalogItemId);
        return next;
      });
    }
  };

  const handleBulkLink = async () => {
    if (selected.size === 0) return;

    const links = items
      .filter((item) => selected.has(item.catalogItemId) && item.bestMatch)
      .map((item) => ({
        catalogItemId: item.catalogItemId,
        productId: item.bestMatch!.productId,
      }));

    if (links.length === 0) return;

    setLinking(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}/catalog/bulk-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const data = await res.json();

      if (data.linked > 0) {
        toast.success(`${data.linked} productos vinculados`);
      }
      if (data.errors && data.errors.length > 0) {
        toast.error(`${data.errors.length} errores: ${data.errors[0]}`);
      }

      // Refresh the page data
      fetchMatches();
    } catch {
      toast.error("Error al vincular productos");
    } finally {
      setLinking(false);
    }
  };

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <h1 className="text-2xl font-bold">Vinculación Masiva</h1>
        <Badge variant="outline">{total.toLocaleString()} sin vincular</Badge>
      </div>

      {/* Toolbar */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-4 items-center flex-wrap">
            <div className="flex gap-2 flex-1 min-w-[250px]">
              <Input
                placeholder="Buscar por nombre, código o SKU..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setSearch(searchInput);
                    setPage(1);
                  }
                }}
              />
              <Button
                variant="secondary"
                onClick={() => { setSearch(searchInput); setPage(1); }}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <Select value={minScore} onValueChange={(v) => { setMinScore(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filtrar por score" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los scores</SelectItem>
                <SelectItem value="0.9">Score &ge; 90%</SelectItem>
                <SelectItem value="0.7">Score &ge; 70%</SelectItem>
                <SelectItem value="0.5">Score &ge; 50%</SelectItem>
              </SelectContent>
            </Select>
            <Select value={matchType} onValueChange={(v) => { setMatchType(v); setPage(1); }}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Tipo de match" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                <SelectItem value="sku_exact">SKU exacto</SelectItem>
                <SelectItem value="sku_partial">SKU parcial</SelectItem>
                <SelectItem value="name_similarity">Nombre similar</SelectItem>
                <SelectItem value="none">Sin match</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1" />
            {selected.size > 0 && (
              <Button onClick={handleBulkLink} disabled={linking}>
                {linking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4 mr-2" />
                )}
                Vincular seleccionados ({selected.size})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Match Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <input
                    type="checkbox"
                    checked={selectableItems.length > 0 && selected.size === selectableItems.length}
                    onChange={toggleSelectAll}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </TableHead>
                <TableHead className="w-[60px]">Score</TableHead>
                <TableHead>Código Interno</TableHead>
                <TableHead>SKU Proveedor</TableHead>
                <TableHead>SKU Propio</TableHead>
                <TableHead>Nombre Proveedor</TableHead>
                <TableHead>Nombre Propio</TableHead>
                <TableHead className="text-right">Precio Prov. (ARS)</TableHead>
                <TableHead className="text-right">Precio Propio (ARS)</TableHead>
                <TableHead className="w-[80px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(10)].map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-4 bg-muted animate-pulse rounded w-20" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                    {items.length === 0
                      ? "No hay items sin vincular en este catálogo"
                      : "No hay items que coincidan con el filtro seleccionado"}
                  </TableCell>
                </TableRow>
              ) : (
                visibleItems.map((item) => {
                  const match = item.bestMatch;
                  const hasMatch = match !== null;
                  const isSelected = selected.has(item.catalogItemId);

                  return (
                    <Fragment key={item.catalogItemId}>
                    <TableRow
                      className={isSelected ? "bg-blue-50 dark:bg-blue-950" : ""}
                    >
                      <TableCell>
                        {hasMatch && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(item.catalogItemId)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        {match ? confidenceBadge(match.confidence) : (
                          <Badge variant="outline">-</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.supplierCode || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.supplierSku || "-"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {match?.productSku || "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={item.supplierDescription}>
                        {item.supplierDescription || "-"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={match?.productName || ""}>
                        {match ? (
                          <Link
                            href={`/products/${match.productId}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {match.productName.substring(0, 50)}
                            {match.productName.length > 50 ? "..." : ""}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Sin match</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {item.supplierPriceArs ? formatARS(item.supplierPriceArs) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {match?.productPrice ? formatARS(match.productPrice) : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {hasMatch ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => dismissItem(item.catalogItemId, item.supplierCode, "match")}
                              title="Descartar match"
                            >
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setLinkingItemId(
                                    linkingItemId === item.catalogItemId ? null : item.catalogItemId
                                  );
                                  setLinkSearch("");
                                  setLinkResults([]);
                                }}
                                title="Vincular a producto existente"
                              >
                                <Link2 className="h-4 w-4 mr-1" />
                                Vincular
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const params = new URLSearchParams();
                                  if (item.supplierDescription) params.set("name", item.supplierDescription);
                                  if (item.supplierSku) params.set("sku", item.supplierSku);
                                  params.set("catalogItemId", String(item.catalogItemId));
                                  params.set("supplierId", supplierId);
                                  router.push(`/products/new?${params}`);
                                }}
                                title="Crear producto nuevo"
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Crear
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => dismissItem(item.catalogItemId, item.supplierCode, "create")}
                                title="Descartar permanentemente"
                              >
                                <X className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {/* Fila expandida de búsqueda manual — solo para "Sin match" */}
                    {!hasMatch && linkingItemId === item.catalogItemId && (
                      <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                        <TableCell colSpan={10} className="py-3 px-6">
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1 max-w-md">
                              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                              <Input
                                autoFocus
                                placeholder="Buscar producto por nombre o SKU..."
                                className="pl-9"
                                value={linkSearch}
                                onChange={(e) => setLinkSearch(e.target.value)}
                              />
                            </div>
                            {linkLoading && (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setLinkingItemId(null); setLinkSearch(""); }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                          {linkResults.length > 0 && (
                            <div className="mt-2 border rounded-md overflow-hidden max-w-xl">
                              {linkResults.map((p) => (
                                <button
                                  key={p.id}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted border-b last:border-b-0 flex items-center justify-between gap-4"
                                  onClick={() => handleManualLink(item.catalogItemId, p.id)}
                                >
                                  <span className="font-medium truncate">{p.name}</span>
                                  {p.sku && (
                                    <span className="font-mono text-xs text-muted-foreground shrink-0">
                                      {p.sku}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                          {!linkLoading && linkSearch.trim() && linkResults.length === 0 && (
                            <p className="mt-2 text-sm text-muted-foreground">
                              Sin resultados para &quot;{linkSearch}&quot;
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
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
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
