"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Search,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  CheckCircle2,
  XCircle,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuscadorItem {
  id: number;
  groupName: string;
  label: string;
  filterCategory: string;
  filterMustKeywords: string | null; // JSON: string[] — ALL must match (AND)
  filterKeywords: string | null;     // JSON: string[] — ANY can match (OR)
  filterAttributes: string | null;   // JSON: {socket?:string, memoryType?:string}
  filterMinPrice: number | null;
  filterMaxPrice: number | null;
  sortOrder: number;
  resolvedProductId: number | null;
  resolvedProductName: string | null;
  resolvedPrice: number | null;
  resolvedHasStock: boolean | null;
  resolvedAt: string | null;
}

interface CategoryOption {
  category: string;
  count: number;
}

interface SlotAttrs {
  socket: string;      // "" = any
  memoryType: string;  // "" = any
}

interface EditState {
  label: string;
  filterCategory: string;
  filterMustKeywords: string; // comma-separated (línea 2 OR — any can match, ANDed with line 1)
  filterKeywords: string;     // comma-separated (OR  — any can match)
  filterMinPrice: string;     // optional min price (ARS), empty = no limit
  filterMaxPrice: string;     // optional max price (ARS), empty = no limit
  attrs: SlotAttrs;
}

// ─── Context-aware attribute logic ───────────────────────────────────────────

/**
 * Determine which attribute selectors to show based on the selected category.
 * showSocket:     mothers, CPUs
 * showMemoryType: mothers, RAM
 */
function getAttrOptions(category: string) {
  const cat = category.toLowerCase();
  const isMother  = cat.includes("mother") || cat.includes("placa") || cat.includes("madre");
  const isRam     = cat.includes("memor") || cat.includes("sodimm");
  const isCpu     = cat.includes("procesador") || cat.includes("cpu");
  return {
    showSocket:     isMother || isCpu,
    showMemoryType: isMother || isRam,
  };
}

function parseAttrs(json: string | null): SlotAttrs {
  if (!json) return { socket: "", memoryType: "" };
  try {
    const obj = JSON.parse(json);
    return { socket: obj.socket ?? "", memoryType: obj.memoryType ?? "" };
  } catch {
    return { socket: "", memoryType: "" };
  }
}

function buildAttrsJson(attrs: SlotAttrs): string | null {
  const obj: Record<string, string> = {};
  if (attrs.socket) obj.socket = attrs.socket;
  if (attrs.memoryType) obj.memoryType = attrs.memoryType;
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : null;
}

function attrsLabel(json: string | null): string {
  if (!json) return "";
  try {
    const obj = JSON.parse(json) as Record<string, string>;
    const parts: string[] = [];
    if (obj.socket) parts.push(`Socket ${obj.socket}`);
    if (obj.memoryType) parts.push(obj.memoryType);
    return parts.join(" · ");
  } catch { return ""; }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryAutocomplete({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: CategoryOption[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = value
    ? categories.filter((c) => c.category.toLowerCase().includes(value.toLowerCase())).slice(0, 8)
    : categories.slice(0, 8);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-7 text-xs"
        placeholder="Categoría exacta del catálogo"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-30 top-full left-0 right-0 bg-popover border rounded-md shadow-lg mt-0.5 max-h-52 overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.category}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex justify-between items-center gap-2"
              onMouseDown={() => { onChange(c.category); setOpen(false); }}
            >
              <span>{c.category}</span>
              <span className="text-muted-foreground shrink-0">{c.count} prod.</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Dropdowns de socket + tipo de memoria según la categoría seleccionada */
function AttributeSelectors({
  category,
  attrs,
  onChange,
}: {
  category: string;
  attrs: SlotAttrs;
  onChange: (a: SlotAttrs) => void;
}) {
  const { showSocket, showMemoryType } = getAttrOptions(category);
  if (!showSocket && !showMemoryType) return null;

  return (
    <div className="flex gap-2 flex-wrap mt-1.5">
      {showSocket && (
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Socket</Label>
          <Select
            value={attrs.socket || "any"}
            onValueChange={(v) => onChange({ ...attrs, socket: v === "any" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-xs w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquiera</SelectItem>
              <SelectItem value="AM4">AM4</SelectItem>
              <SelectItem value="AM5">AM5</SelectItem>
              <SelectItem value="LGA 1151">LGA 1151</SelectItem>
              <SelectItem value="LGA 1200">LGA 1200</SelectItem>
              <SelectItem value="LGA 1700">LGA 1700</SelectItem>
              <SelectItem value="LGA 1851">LGA 1851</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {showMemoryType && (
        <div className="flex items-center gap-1.5">
          <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Memoria</Label>
          <Select
            value={attrs.memoryType || "any"}
            onValueChange={(v) => onChange({ ...attrs, memoryType: v === "any" ? "" : v })}
          >
            <SelectTrigger className="h-7 text-xs w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Cualquiera</SelectItem>
              <SelectItem value="DDR3">DDR3</SelectItem>
              <SelectItem value="DDR4">DDR4</SelectItem>
              <SelectItem value="DDR5">DDR5</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const EMPTY_ATTRS: SlotAttrs = { socket: "", memoryType: "" };
const EMPTY_EDIT: EditState = { label: "", filterCategory: "", filterMustKeywords: "", filterKeywords: "", filterMinPrice: "", filterMaxPrice: "", attrs: EMPTY_ATTRS };

export default function BuscadorPage() {
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [items, setItems] = useState<BuscadorItem[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>(EMPTY_EDIT);

  // Add new item
  const [addingGroup, setAddingGroup] = useState<string | null>(null);
  const [newItem, setNewItem] = useState<EditState & { groupName: string }>({
    ...EMPTY_EDIT, groupName: "",
  });

  // Add new group (top-level "new group" form)
  const [newGroupName, setNewGroupName] = useState("");

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/buscador");
      setItems(await res.json());
    } catch {
      toast.error("Error al cargar buscador");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/products/categories");
      setCategories(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchItems();
    fetchCategories();
  }, [fetchItems, fetchCategories]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/buscador/refresh", { method: "POST" });
      await fetchItems();
      toast.success("Buscador actualizado");
    } catch {
      toast.error("Error al actualizar");
    } finally {
      setRefreshing(false);
    }
  };

  const startEdit = (item: BuscadorItem) => {
    setEditingId(item.id);
    const mustKw: string[] = item.filterMustKeywords ? JSON.parse(item.filterMustKeywords) : [];
    const kw: string[] = item.filterKeywords ? JSON.parse(item.filterKeywords) : [];
    setEditState({
      label: item.label,
      filterCategory: item.filterCategory,
      filterMustKeywords: mustKw.join(", "),
      filterKeywords: kw.join(", "),
      filterMinPrice: item.filterMinPrice != null ? String(item.filterMinPrice) : "",
      filterMaxPrice: item.filterMaxPrice != null ? String(item.filterMaxPrice) : "",
      attrs: parseAttrs(item.filterAttributes),
    });
  };

  const saveEdit = async (id: number) => {
    try {
      const mustKeywords = editState.filterMustKeywords
        .split(",").map((k) => k.trim()).filter(Boolean);
      const keywords = editState.filterKeywords
        .split(",").map((k) => k.trim()).filter(Boolean);
      const filterAttributes = buildAttrsJson(editState.attrs);
      const minPrice = editState.filterMinPrice !== "" ? parseFloat(editState.filterMinPrice) : null;
      const maxPrice = editState.filterMaxPrice !== "" ? parseFloat(editState.filterMaxPrice) : null;
      await fetch(`/api/buscador/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editState.label,
          filterCategory: editState.filterCategory,
          filterMustKeywords: mustKeywords.length > 0 ? mustKeywords : null,
          filterKeywords: keywords,
          filterAttributes,
          filterMinPrice: isNaN(minPrice!) ? null : minPrice,
          filterMaxPrice: isNaN(maxPrice!) ? null : maxPrice,
        }),
      });
      setEditingId(null);
      await fetchItems();
      toast.success("Guardado");
    } catch {
      toast.error("Error al guardar");
    }
  };

  const handleDelete = async (id: number, label: string) => {
    if (!confirm(`¿Eliminar "${label}"?`)) return;
    try {
      await fetch(`/api/buscador/${id}`, { method: "DELETE" });
      await fetchItems();
      toast.success("Eliminado");
    } catch {
      toast.error("Error al eliminar");
    }
  };

  const handleAddItem = async (groupName: string) => {
    try {
      const mustKeywords = newItem.filterMustKeywords
        .split(",").map((k) => k.trim()).filter(Boolean);
      const keywords = newItem.filterKeywords
        .split(",").map((k) => k.trim()).filter(Boolean);
      const filterAttributes = buildAttrsJson(newItem.attrs);
      const minPrice = newItem.filterMinPrice !== "" ? parseFloat(newItem.filterMinPrice) : null;
      const maxPrice = newItem.filterMaxPrice !== "" ? parseFloat(newItem.filterMaxPrice) : null;
      await fetch("/api/buscador", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName,
          label: newItem.label,
          filterCategory: newItem.filterCategory || groupName,
          filterMustKeywords: mustKeywords.length > 0 ? mustKeywords : null,
          filterKeywords: keywords,
          filterAttributes,
          filterMinPrice: minPrice != null && !isNaN(minPrice) ? minPrice : null,
          filterMaxPrice: maxPrice != null && !isNaN(maxPrice) ? maxPrice : null,
          sortOrder: 99,
        }),
      });
      setAddingGroup(null);
      setNewGroupName("");
      setNewItem({ ...EMPTY_EDIT, groupName: "" });
      await fetchItems();
      toast.success("Componente agregado");
    } catch {
      toast.error("Error al agregar");
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  const fmt = (price: number) => "$" + Math.round(price).toLocaleString("es-AR");

  const fmtRelative = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "ahora mismo";
    if (mins < 60) return `hace ${mins}m`;
    const h = Math.floor(mins / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
  };

  // Group items, preserving creation order (min id per group)
  const grouped: Record<string, BuscadorItem[]> = {};
  for (const item of items) {
    if (!grouped[item.groupName]) grouped[item.groupName] = [];
    grouped[item.groupName].push(item);
  }
  const groupEntries = Object.entries(grouped).sort(
    ([, a], [, b]) => Math.min(...a.map((i) => i.id)) - Math.min(...b.map((i) => i.id))
  );

  const lastRefreshedAt = items.map((i) => i.resolvedAt).filter(Boolean).sort().at(-1);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded w-60" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="h-6 w-6" /> Buscador de Componentes
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configura los filtros de cada componente y el sistema encuentra el más barato en stock.
            {lastRefreshedAt && (
              <> · Actualizado {fmtRelative(lastRefreshedAt)}</>
            )}
          </p>
        </div>
        {!isViewer && (
          <Button onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Actualizando..." : "Actualizar todo"}
          </Button>
        )}
      </div>

      {/* Groups */}
      {groupEntries.map(([groupName, groupItems]) => {
        const resolved = groupItems.filter((i) => i.resolvedProductId !== null).length;
        return (
          <Card key={groupName}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle className="text-base">{groupName}</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  {resolved}/{groupItems.length} con resultado
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-[160px] pl-4">Componente</TableHead>
                    <TableHead>Categoría · Línea 1 (OR) · Línea 2 (OR, AND con L1) · Atributos</TableHead>
                    <TableHead>Producto más barato</TableHead>
                    <TableHead className="text-right w-[120px]">Precio</TableHead>
                    <TableHead className="text-center w-[60px]">Stock</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupItems.map((item) =>
                    editingId === item.id ? (
                      /* ── EDIT ROW ─────────────────────────────────────── */
                      <TableRow key={item.id} className="bg-muted/30">
                        <TableCell className="pl-4 align-top pt-3">
                          <Input
                            value={editState.label}
                            onChange={(e) => setEditState({ ...editState, label: e.target.value })}
                            className="h-7 text-sm"
                            placeholder="Etiqueta"
                          />
                        </TableCell>
                        <TableCell className="align-top pt-3">
                          <div className="space-y-1.5 max-w-xs">
                            <CategoryAutocomplete
                              value={editState.filterCategory}
                              onChange={(v) =>
                                setEditState({
                                  ...editState,
                                  filterCategory: v,
                                  attrs: EMPTY_ATTRS,
                                })
                              }
                              categories={categories}
                            />
                            <Input
                              value={editState.filterKeywords}
                              onChange={(e) => setEditState({ ...editState, filterKeywords: e.target.value })}
                              className="h-7 text-xs"
                              placeholder="Línea 1 (OR): ej: 8GB 3200MHz, 8GB 3600MHz"
                            />
                            <Input
                              value={editState.filterMustKeywords}
                              onChange={(e) => setEditState({ ...editState, filterMustKeywords: e.target.value })}
                              className="h-7 text-xs"
                              placeholder="Línea 2 (OR + AND con L1): ej: Corsair, Kingston"
                            />
                            <div className="flex gap-1.5">
                              <Input
                                type="number"
                                value={editState.filterMinPrice}
                                onChange={(e) => setEditState({ ...editState, filterMinPrice: e.target.value })}
                                className="h-7 text-xs w-[90px]"
                                placeholder="Precio min"
                              />
                              <Input
                                type="number"
                                value={editState.filterMaxPrice}
                                onChange={(e) => setEditState({ ...editState, filterMaxPrice: e.target.value })}
                                className="h-7 text-xs w-[90px]"
                                placeholder="Precio max"
                              />
                            </div>
                            <AttributeSelectors
                              category={editState.filterCategory}
                              attrs={editState.attrs}
                              onChange={(a) => setEditState({ ...editState, attrs: a })}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground italic align-top pt-3" colSpan={2}>
                          Guardá y actualizá para ver resultado
                        </TableCell>
                        <TableCell />
                        <TableCell className="align-top pt-2.5">
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => saveEdit(item.id)}>
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditingId(null)}>
                              <X className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      /* ── READ ROW ─────────────────────────────────────── */
                      <TableRow key={item.id}>
                        <TableCell className="pl-4 font-medium text-sm">{item.label}</TableCell>
                        <TableCell>
                          <div className="text-xs space-y-1">
                            <span className="font-mono text-muted-foreground">{item.filterCategory}</span>
                            <div className="flex flex-wrap gap-1 items-center">
                              {/* Línea 1 — badges grises (OR, cualquiera) */}
                              {item.filterKeywords &&
                                (JSON.parse(item.filterKeywords) as string[]).map((kw) => (
                                  <Badge key={kw} variant="secondary" className="text-[10px] px-1 py-0">
                                    {kw}
                                  </Badge>
                                ))}
                              {/* Línea 2 — badges naranja con separador AND (OR dentro, AND con línea 1) */}
                              {item.filterMustKeywords &&
                                (JSON.parse(item.filterMustKeywords) as string[]).length > 0 && (
                                  <>
                                    <span className="text-[10px] font-semibold text-muted-foreground">AND</span>
                                    {(JSON.parse(item.filterMustKeywords) as string[]).map((kw) => (
                                      <Badge key={`must-${kw}`} variant="outline" className="text-[10px] px-1 py-0 border-orange-400 text-orange-600 dark:border-orange-500 dark:text-orange-400">
                                        {kw}
                                      </Badge>
                                    ))}
                                  </>
                                )}
                              {item.filterAttributes && (() => {
                                const label = attrsLabel(item.filterAttributes);
                                return label ? (
                                  <Badge variant="outline" className="text-[10px] px-1 py-0 border-primary/50 text-primary">
                                    <Tag className="h-2.5 w-2.5 mr-0.5" />
                                    {label}
                                  </Badge>
                                ) : null;
                              })()}
                              {/* Price range badges */}
                              {item.filterMinPrice != null && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400">
                                  ≥ ${item.filterMinPrice.toLocaleString("es-AR")}
                                </Badge>
                              )}
                              {item.filterMaxPrice != null && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400">
                                  ≤ ${item.filterMaxPrice.toLocaleString("es-AR")}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.resolvedProductName ? (
                            <span className="text-sm">{item.resolvedProductName}</span>
                          ) : item.resolvedAt ? (
                            <span className="text-xs text-muted-foreground italic">Sin resultado — revisar filtros</span>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">No calculado — presioná Actualizar</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm">
                          {item.resolvedPrice != null ? fmt(item.resolvedPrice) : <span className="text-muted-foreground font-normal">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          {item.resolvedAt === null ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : item.resolvedHasStock ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                          )}
                        </TableCell>
                        <TableCell>
                          {!isViewer && (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => startEdit(item)} title="Editar">
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-7 px-2 text-red-500 hover:text-red-700"
                                onClick={() => handleDelete(item.id, item.label)} title="Eliminar"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  )}

                  {/* ── ADD ROW ─────────────────────────────────────────── */}
                  {addingGroup === groupName ? (
                    <TableRow className="bg-muted/20">
                      <TableCell className="pl-4 align-top pt-3">
                        <Input
                          value={newItem.label}
                          onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
                          className="h-7 text-sm"
                          placeholder="Etiqueta (ej: Low)"
                          autoFocus
                        />
                      </TableCell>
                      <TableCell className="align-top pt-3">
                        <div className="space-y-1.5 max-w-xs">
                          <CategoryAutocomplete
                            value={newItem.filterCategory}
                            onChange={(v) => setNewItem({ ...newItem, filterCategory: v, attrs: EMPTY_ATTRS })}
                            categories={categories}
                          />
                          <Input
                            value={newItem.filterKeywords}
                            onChange={(e) => setNewItem({ ...newItem, filterKeywords: e.target.value })}
                            className="h-7 text-xs"
                            placeholder="Línea 1 (OR): ej: 8GB 3200MHz, 8GB 3600MHz"
                          />
                          <Input
                            value={newItem.filterMustKeywords}
                            onChange={(e) => setNewItem({ ...newItem, filterMustKeywords: e.target.value })}
                            className="h-7 text-xs"
                            placeholder="Línea 2 (OR + AND con L1): ej: Corsair, Kingston"
                          />
                          <div className="flex gap-1.5">
                            <Input
                              type="number"
                              value={newItem.filterMinPrice}
                              onChange={(e) => setNewItem({ ...newItem, filterMinPrice: e.target.value })}
                              className="h-7 text-xs w-[90px]"
                              placeholder="Precio min"
                            />
                            <Input
                              type="number"
                              value={newItem.filterMaxPrice}
                              onChange={(e) => setNewItem({ ...newItem, filterMaxPrice: e.target.value })}
                              className="h-7 text-xs w-[90px]"
                              placeholder="Precio max"
                            />
                          </div>
                          <AttributeSelectors
                            category={newItem.filterCategory}
                            attrs={newItem.attrs}
                            onChange={(a) => setNewItem({ ...newItem, attrs: a })}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground italic align-top pt-3" colSpan={2}>
                        Se calculará al actualizar
                      </TableCell>
                      <TableCell />
                      <TableCell className="align-top pt-2.5">
                        <div className="flex gap-1">
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2"
                            onClick={() => handleAddItem(groupName)}
                            disabled={!newItem.label}
                          >
                            <Check className="h-3.5 w-3.5 text-green-600" />
                          </Button>
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2"
                            onClick={() => { setAddingGroup(null); setNewItem({ ...EMPTY_EDIT, groupName: "" }); }}
                          >
                            <X className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : !isViewer ? (
                    <TableRow>
                      <TableCell colSpan={6} className="pl-4">
                        <Button
                          variant="ghost" size="sm"
                          className="text-muted-foreground h-7 text-xs"
                          onClick={() => {
                            setAddingGroup(groupName);
                            setNewItem({ ...EMPTY_EDIT, groupName, filterCategory: groupItems[0]?.filterCategory ?? "" });
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Agregar componente
                        </Button>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Add new group ──────────────────────────────────────────────────── */}
      {!isViewer && <Card className="border-dashed">
        <CardContent className="py-5">
          {addingGroup === "__new__" ? (
            <div className="space-y-3">
              <p className="text-sm font-medium">Nuevo grupo de componentes</p>
              <div className="flex gap-2 flex-wrap items-end">
                <div className="space-y-1">
                  <Label className="text-xs">Nombre del grupo</Label>
                  <Input
                    placeholder="ej: Fuentes"
                    className="h-8 w-44"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Etiqueta del primer ítem</Label>
                  <Input
                    placeholder="ej: 650W"
                    className="h-8 w-32"
                    value={newItem.label}
                    onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
                  />
                </div>
                <div className="space-y-1 min-w-[200px]">
                  <Label className="text-xs">Categoría de producto</Label>
                  <CategoryAutocomplete
                    value={newItem.filterCategory}
                    onChange={(v) => setNewItem({ ...newItem, filterCategory: v, attrs: EMPTY_ATTRS })}
                    categories={categories}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Línea 1 (OR)</Label>
                  <Input
                    placeholder="ej: 650W, 700W"
                    className="h-7 w-36 text-xs"
                    value={newItem.filterKeywords}
                    onChange={(e) => setNewItem({ ...newItem, filterKeywords: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Línea 2 (OR + AND L1)</Label>
                  <Input
                    placeholder="ej: Corsair, EVGA"
                    className="h-7 w-36 text-xs"
                    value={newItem.filterMustKeywords}
                    onChange={(e) => setNewItem({ ...newItem, filterMustKeywords: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Precio min (ARS)</Label>
                  <Input
                    type="number"
                    placeholder="ej: 50000"
                    className="h-7 w-28 text-xs"
                    value={newItem.filterMinPrice}
                    onChange={(e) => setNewItem({ ...newItem, filterMinPrice: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Precio max (ARS)</Label>
                  <Input
                    type="number"
                    placeholder="opcional"
                    className="h-7 w-28 text-xs"
                    value={newItem.filterMaxPrice}
                    onChange={(e) => setNewItem({ ...newItem, filterMaxPrice: e.target.value })}
                  />
                </div>
              </div>
              {newItem.filterCategory && (
                <AttributeSelectors
                  category={newItem.filterCategory}
                  attrs={newItem.attrs}
                  onChange={(a) => setNewItem({ ...newItem, attrs: a })}
                />
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAddItem(newGroupName || newItem.filterCategory)}
                  disabled={!newItem.label || !newGroupName}
                >
                  Crear grupo
                </Button>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => {
                    setAddingGroup(null);
                    setNewGroupName("");
                    setNewItem({ ...EMPTY_EDIT, groupName: "" });
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center">
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => {
                  setAddingGroup("__new__");
                  setNewItem({ ...EMPTY_EDIT, groupName: "" });
                  setNewGroupName("");
                }}
              >
                <Plus className="h-4 w-4 mr-2" /> Agregar grupo de componentes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>}
    </div>
  );
}
