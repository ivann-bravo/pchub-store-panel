"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  XCircle,
  Plus,
  Trash2,
  Save,
  Edit,
  Package,
  ExternalLink,
  GripVertical,
  ChevronDown,
  Sparkles,
  Copy,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { ComboTemplateWithSlots, ComboResolutionResult, SlotResolutionResult } from "@/types";

interface SlotDraft {
  id?: number;
  slotName: string;
  slotType: "auto" | "fixed" | "combo";
  quantity: number;
  sortOrder: number;
  filterCategory: string;
  filterKeywords: string; // comma-separated for UI
  filterMemoryType: string; // "" | "DDR3" | "DDR4" | "DDR5"
  filterSocket: string;    // "" | "AM4" | "AM5" | "1700" | etc.
  fixedProductId: number | null;
  fixedComboId: number | null;
  fixedProductName?: string; // display only
}

function NestedComboDetail({ data }: { data: ComboTemplateWithSlots }) {
  return (
    <div className="py-2 px-4 border-l-2 border-primary/20 ml-6 space-y-1">
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-medium text-muted-foreground">
          Componentes de
        </p>
        <a
          href={`/combos/${data.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-0.5"
        >
          {data.name}
          <ExternalLink className="h-2.5 w-2.5 ml-0.5" />
        </a>
      </div>
      {data.slots.map((slot) => (
        <div key={slot.id} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground text-xs shrink-0">{slot.quantity}×</span>
            <span className="text-xs text-muted-foreground shrink-0">{slot.slotName}:</span>
            {slot.resolvedProductName && slot.resolvedProductId ? (
              <a
                href={`/products/${slot.resolvedProductId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-0.5 truncate"
              >
                {slot.resolvedProductName}
                <ExternalLink className="h-2.5 w-2.5 shrink-0 ml-0.5" />
              </a>
            ) : (
              <span className="text-xs text-muted-foreground italic">Sin resolver</span>
            )}
          </div>
          {slot.resolvedPrice != null && (
            <span className="text-xs font-medium shrink-0">
              ${(slot.resolvedPrice * slot.quantity).toLocaleString("es-AR", { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function parseKeywords(kw: string | null | undefined): string {
  if (!kw) return "";
  try {
    const arr = JSON.parse(kw);
    return Array.isArray(arr) ? arr.join(", ") : kw;
  } catch {
    return kw;
  }
}

export default function ComboDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";

  const [combo, setCombo] = useState<ComboTemplateWithSlots | null>(null);
  const [resolution, setResolution] = useState<ComboResolutionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedComboSlots, setExpandedComboSlots] = useState<Set<number>>(new Set());
  const [nestedComboData, setNestedComboData] = useState<Record<number, ComboTemplateWithSlots>>({});

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSlots, setEditSlots] = useState<SlotDraft[]>([]);

  // Description state
  const [description, setDescription] = useState("");
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [savingDesc, setSavingDesc] = useState(false);
  const [descTab, setDescTab] = useState<"edit" | "preview">("edit");

  // Product search for fixed slots
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [productResults, setProductResults] = useState<Record<number, { id: number; name: string; sku: string | null }[]>>({});

  // Combo search for combo-type slots
  const [comboSearch, setComboSearch] = useState<Record<number, string>>({});
  const [comboResults, setComboResults] = useState<Record<number, { id: number; name: string; sku: string }[]>>({});

  const fetchCombo = useCallback(async () => {
    try {
      const res = await fetch(`/api/combos/${id}`);
      if (!res.ok) { router.push("/combos"); return; }
      const data: ComboTemplateWithSlots = await res.json();
      setCombo(data);
      setEditName(data.name);
      setEditNotes(data.notes ?? "");
      setDescription(data.description ?? "");
      setEditSlots(
        data.slots.map((s, i) => {
          let filterMemoryType = "";
          let filterSocket = "";
          if (s.filterAttributes) {
            try {
              const attrs = JSON.parse(s.filterAttributes);
              filterMemoryType = attrs.memoryType ?? "";
              filterSocket = attrs.socket ?? "";
            } catch {}
          }
          return {
            id: s.id,
            slotName: s.slotName,
            slotType: s.slotType,
            quantity: s.quantity,
            sortOrder: i,
            filterCategory: s.filterCategory ?? "",
            filterKeywords: parseKeywords(s.filterKeywords),
            filterMemoryType,
            filterSocket,
            fixedProductId: s.fixedProductId ?? null,
            fixedComboId: s.fixedComboId ?? null,
          };
        })
      );
    } catch {
      toast.error("Error al cargar combo");
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchCombo();
  }, [fetchCombo]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/combos/${id}/refresh`, { method: "POST" });
      const data: ComboResolutionResult = await res.json();
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Error");
      setResolution(data);
      fetchCombo();
      const errCount = data.errors.length;
      if (errCount === 0) {
        toast.success(`Combo actualizado: $${data.totalPrice?.toLocaleString("es-AR") ?? "—"}`);
      } else {
        toast.warning(`${errCount} slot${errCount !== 1 ? "s" : ""} sin resolver`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const slots = editSlots.map((s, i) => {
        let filterAttributes: Record<string, string> | null = null;
        if (s.slotType === "auto") {
          const attrs: Record<string, string> = {};
          if (s.filterMemoryType) attrs.memoryType = s.filterMemoryType;
          if (s.filterSocket) attrs.socket = s.filterSocket;
          if (Object.keys(attrs).length > 0) filterAttributes = attrs;
        }
        return {
          slotName: s.slotName,
          slotType: s.slotType,
          quantity: s.quantity,
          sortOrder: i,
          fixedProductId: s.slotType === "fixed" ? s.fixedProductId : null,
          fixedComboId: s.slotType === "combo" ? s.fixedComboId : null,
          filterCategory: s.slotType === "auto" ? s.filterCategory : null,
          filterKeywords:
            s.slotType === "auto" && s.filterKeywords
              ? s.filterKeywords.split(",").map((k) => k.trim()).filter(Boolean)
              : null,
          filterAttributes,
        };
      });

      const res = await fetch(`/api/combos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName, notes: editNotes, slots }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      toast.success("Combo guardado");
      setEditing(false);
      fetchCombo();
    } catch {
      toast.error("Error al guardar combo");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`¿Eliminar el combo ${combo?.sku}? Esta acción no se puede deshacer.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/combos/${id}`, { method: "DELETE" });
      toast.success("Combo eliminado");
      router.push("/combos");
    } catch {
      toast.error("Error al eliminar");
      setDeleting(false);
    }
  };

  const addSlot = () => {
    setEditSlots((prev) => [
      ...prev,
      {
        slotName: "",
        slotType: "auto",
        quantity: 1,
        sortOrder: prev.length,
        filterCategory: "",
        filterKeywords: "",
        filterMemoryType: "",
        filterSocket: "",
        fixedProductId: null,
        fixedComboId: null,
      },
    ]);
  };

  const removeSlot = (idx: number) => {
    setEditSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, patch: Partial<SlotDraft>) => {
    setEditSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  // Product search for fixed slots
  const searchProducts = async (idx: number, query: string) => {
    setProductSearch((prev) => ({ ...prev, [idx]: query }));
    if (query.length < 2) {
      setProductResults((prev) => ({ ...prev, [idx]: [] }));
      return;
    }
    try {
      const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=6`);
      const data = await res.json();
      setProductResults((prev) => ({ ...prev, [idx]: data.data ?? [] }));
    } catch {
      // ignore
    }
  };

  const selectFixedProduct = (idx: number, product: { id: number; name: string; sku: string | null }) => {
    updateSlot(idx, { fixedProductId: product.id, fixedProductName: product.name });
    setProductSearch((prev) => ({ ...prev, [idx]: product.name }));
    setProductResults((prev) => ({ ...prev, [idx]: [] }));
  };

  // Combo search for combo-type slots
  const searchCombos = async (idx: number, query: string) => {
    setComboSearch((prev) => ({ ...prev, [idx]: query }));
    if (query.length < 2) {
      setComboResults((prev) => ({ ...prev, [idx]: [] }));
      return;
    }
    try {
      const res = await fetch(`/api/combos`);
      const data: { id: number; name: string; sku: string }[] = await res.json();
      const q = query.toLowerCase();
      const filtered = data
        .filter((c) => c.id !== parseInt(id) && (c.name.toLowerCase().includes(q) || c.sku.toLowerCase().includes(q)))
        .slice(0, 6);
      setComboResults((prev) => ({ ...prev, [idx]: filtered }));
    } catch {
      // ignore
    }
  };

  const selectFixedCombo = (idx: number, combo: { id: number; name: string; sku: string }) => {
    updateSlot(idx, { fixedComboId: combo.id, slotName: combo.name });
    setComboSearch((prev) => ({ ...prev, [idx]: combo.name }));
    setComboResults((prev) => ({ ...prev, [idx]: [] }));
  };

  // Build resolution map for display
  const resolutionMap: Record<number, SlotResolutionResult> = {};
  if (resolution) {
    for (const s of resolution.slots) {
      resolutionMap[s.slotId] = s;
    }
  }

  const toggleComboExpand = async (slotId: number, comboId: number) => {
    const willExpand = !expandedComboSlots.has(slotId);
    setExpandedComboSlots((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
    if (willExpand && !nestedComboData[comboId]) {
      try {
        const res = await fetch(`/api/combos/${comboId}`);
        if (res.ok) {
          const data: ComboTemplateWithSlots = await res.json();
          setNestedComboData((prev) => ({ ...prev, [comboId]: data }));
        }
      } catch { /* ignore */ }
    }
  };

  const handleGenerateDescription = async () => {
    setGeneratingDesc(true);
    try {
      const res = await fetch(`/api/combos/${id}/generate-description`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al generar");
      setDescription(data.description);
      toast.success("Descripción generada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al generar descripción");
    } finally {
      setGeneratingDesc(false);
    }
  };

  const handleSaveDescription = async () => {
    setSavingDesc(true);
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error("Error al guardar");
      toast.success("Descripción guardada");
    } catch {
      toast.error("Error al guardar descripción");
    } finally {
      setSavingDesc(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded w-64" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!combo) return null;

  const totalFromSlots =
    resolution?.totalPrice ??
    (combo.lastTotalPrice != null ? combo.lastTotalPrice : null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/combos">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
        </Link>
        <div className="flex-1">
          {editing ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="text-lg font-bold h-9 max-w-md"
                  placeholder="Nombre del combo"
                />
                <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded shrink-0">
                  {combo.sku}
                </span>
              </div>
              <Input
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                className="text-sm max-w-lg"
                placeholder="Notas (opcional)"
              />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{combo.name}</h1>
                <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {combo.sku}
                </span>
              </div>
              {combo.notes && (
                <p className="text-sm text-muted-foreground mt-0.5">{combo.notes}</p>
              )}
            </>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {combo.lastRefreshedAt == null ? (
            <Badge variant="secondary">Sin calcular</Badge>
          ) : combo.lastHasStock ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle className="h-3 w-3" /> Stock completo
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="h-3 w-3" /> Sin stock
            </Badge>
          )}
          {combo.productId && (
            <Link href={`/products/${combo.productId}`}>
              <Button variant="outline" size="sm">
                <Package className="h-4 w-4 mr-1" /> Producto
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </Link>
          )}
          {!isViewer && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setEditing(!editing); setResolution(null); }}
            >
              <Edit className="h-4 w-4 mr-1" />
              {editing ? "Cancelar" : "Editar"}
            </Button>
          )}
          <Button onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {refreshing ? "Actualizando..." : "Actualizar"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Slots table */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Componentes</CardTitle>
              <CardDescription>
                Los slots &quot;auto&quot; seleccionan el producto más barato en stock. Los slots &quot;fijos&quot; usan siempre el mismo producto.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!editing ? (
                // Read-only view
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Slot</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Producto resuelto</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Precio unit.</TableHead>
                      <TableHead className="text-center">Stock</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {combo.slots.map((slot) => {
                      const resolved = resolutionMap[slot.id];
                      const displayName =
                        resolved?.resolvedProductName ??
                        slot.resolvedProductName ??
                        null;
                      const displayPrice = resolved?.resolvedPrice ?? slot.resolvedPrice;
                      const hasStock = resolved?.hasStock ?? (slot.resolvedAt != null);
                      const slotError = resolved?.error;
                      const isComboSlot = slot.slotType === "combo" && slot.fixedComboId != null;
                      const isExpanded = expandedComboSlots.has(slot.id);

                      return (
                        <Fragment key={slot.id}>
                          <TableRow>
                            <TableCell>
                              <div>
                                <p className="font-medium">{slot.slotName}</p>
                                {slot.slotType === "auto" && slot.filterCategory && (
                                  <p className="text-xs text-muted-foreground">
                                    {slot.filterCategory}
                                    {slot.filterKeywords && ` · ${parseKeywords(slot.filterKeywords)}`}
                                    {slot.filterAttributes && (() => {
                                      try {
                                        const attrs = JSON.parse(slot.filterAttributes) as Record<string, string>;
                                        const parts: string[] = [];
                                        if (attrs.socket) parts.push(`Socket ${attrs.socket}`);
                                        if (attrs.memoryType) parts.push(attrs.memoryType);
                                        return parts.length > 0 ? ` · ${parts.join(" · ")}` : null;
                                      } catch { return null; }
                                    })()}
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {slot.slotType === "auto" ? "Auto" : slot.slotType === "combo" ? "Combo" : "Fijo"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {displayName ? (
                                <div className="space-y-0.5">
                                  {slot.resolvedProductId ? (
                                    <a
                                      href={`/products/${slot.resolvedProductId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
                                    >
                                      {displayName}
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  ) : (
                                    <p className="text-sm font-medium">{displayName}</p>
                                  )}
                                  {isComboSlot && (
                                    <button
                                      onClick={() => toggleComboExpand(slot.id, slot.fixedComboId!)}
                                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                                    >
                                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                      {isExpanded ? "Ocultar componentes" : "Ver componentes del combo"}
                                    </button>
                                  )}
                                </div>
                              ) : isComboSlot ? (
                                <button
                                  onClick={() => toggleComboExpand(slot.id, slot.fixedComboId!)}
                                  className="text-xs text-primary hover:underline flex items-center gap-0.5"
                                >
                                  <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                  {isExpanded ? "Ocultar combo" : "Ver combo"}
                                </button>
                              ) : slotError ? (
                                <p className="text-xs text-red-500">{slotError}</p>
                              ) : (
                                <p className="text-sm text-muted-foreground">Sin resolver — presioná Actualizar</p>
                              )}
                            </TableCell>
                            <TableCell className="text-center">{slot.quantity}</TableCell>
                            <TableCell className="text-right">
                              {displayPrice != null ? (
                                `$${displayPrice.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              {!slot.resolvedAt && !resolved ? (
                                <span className="text-muted-foreground text-xs">—</span>
                              ) : hasStock ? (
                                <CheckCircle className="h-4 w-4 text-green-600 mx-auto" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500 mx-auto" />
                              )}
                            </TableCell>
                          </TableRow>
                          {isExpanded && isComboSlot && (
                            <TableRow>
                              <TableCell colSpan={6} className="p-0 bg-muted/20">
                                {nestedComboData[slot.fixedComboId!] ? (
                                  <NestedComboDetail data={nestedComboData[slot.fixedComboId!]} />
                                ) : (
                                  <div className="p-4 text-sm text-muted-foreground">Cargando...</div>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                // Edit mode
                <div className="space-y-3">
                  {editSlots.map((slot, idx) => (
                    <div key={idx} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium text-muted-foreground w-6">{idx + 1}.</span>
                        <Input
                          placeholder="Nombre del slot (ej: CPU, Madre, RAM)"
                          value={slot.slotName}
                          onChange={(e) => updateSlot(idx, { slotName: e.target.value })}
                          className="flex-1"
                        />
                        <Select
                          value={slot.slotType}
                          onValueChange={(v) =>
                            updateSlot(idx, { slotType: v as "auto" | "fixed" | "combo" })
                          }
                          disabled={slot.slotType === "combo"}
                        >
                          <SelectTrigger className="w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="fixed">Fijo</SelectItem>
                            <SelectItem value="combo">Combo</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <Label className="text-xs whitespace-nowrap">Qty</Label>
                          <Input
                            type="number"
                            min={1}
                            value={slot.quantity}
                            onChange={(e) =>
                              updateSlot(idx, { quantity: parseInt(e.target.value) || 1 })
                            }
                            className="w-16"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeSlot(idx)}
                          className="text-red-500 hover:text-red-700 shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      {slot.slotType === "combo" ? (
                        <div className="pl-8 space-y-1 relative">
                          <Label className="text-xs">Combo referenciado</Label>
                          <Input
                            placeholder="Buscar combo..."
                            value={comboSearch[idx] ?? slot.slotName ?? ""}
                            onChange={(e) => searchCombos(idx, e.target.value)}
                          />
                          {(comboResults[idx] ?? []).length > 0 && (
                            <div className="absolute z-10 left-0 right-0 bg-background border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                              {comboResults[idx].map((c) => (
                                <button
                                  key={c.id}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                                  onClick={() => selectFixedCombo(idx, c)}
                                >
                                  <span className="font-medium">{c.name}</span>
                                  <span className="text-xs text-muted-foreground font-mono">{c.sku}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {slot.fixedComboId && (
                            <p className="text-xs text-muted-foreground">
                              Slot de combo anidado — el precio se toma del combo referenciado al actualizar.
                            </p>
                          )}
                        </div>
                      ) : slot.slotType === "auto" ? (
                        <div className="grid grid-cols-2 gap-3 pl-8">
                          <div className="space-y-1">
                            <Label className="text-xs">Categoría</Label>
                            <Input
                              placeholder="ej: Procesadores"
                              value={slot.filterCategory}
                              onChange={(e) =>
                                updateSlot(idx, { filterCategory: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Palabras clave (separadas por coma)</Label>
                            <Input
                              placeholder="ej: Ryzen, 8GB"
                              value={slot.filterKeywords}
                              onChange={(e) =>
                                updateSlot(idx, { filterKeywords: e.target.value })
                              }
                            />
                          </div>
                          {/* Atributos de compatibilidad — siempre visibles para auto slots */}
                          <div className="col-span-2 border-t pt-2 mt-1">
                            <p className="text-xs text-muted-foreground mb-2 font-medium">
                              Atributos de compatibilidad (filtra por datos de WooCommerce)
                            </p>
                            <div className="flex flex-wrap gap-3">
                              <div className="space-y-1">
                                <Label className="text-xs">Socket</Label>
                                <Select
                                  value={slot.filterSocket || "any"}
                                  onValueChange={(v) =>
                                    updateSlot(idx, { filterSocket: v === "any" ? "" : v })
                                  }
                                >
                                  <SelectTrigger className="w-36">
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
                              <div className="space-y-1">
                                <Label className="text-xs">Tipo de memoria</Label>
                                <Select
                                  value={slot.filterMemoryType || "any"}
                                  onValueChange={(v) =>
                                    updateSlot(idx, { filterMemoryType: v === "any" ? "" : v })
                                  }
                                >
                                  <SelectTrigger className="w-36">
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
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="pl-8 space-y-1 relative">
                          <Label className="text-xs">Producto fijo</Label>
                          <Input
                            placeholder="Buscar producto..."
                            value={productSearch[idx] ?? slot.fixedProductName ?? ""}
                            onChange={(e) => searchProducts(idx, e.target.value)}
                          />
                          {(productResults[idx] ?? []).length > 0 && (
                            <div className="absolute z-10 left-0 right-0 bg-background border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                              {productResults[idx].map((p) => (
                                <button
                                  key={p.id}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2"
                                  onClick={() => selectFixedProduct(idx, p)}
                                >
                                  <span className="font-medium">{p.name}</span>
                                  {p.sku && (
                                    <span className="text-xs text-muted-foreground font-mono">
                                      {p.sku}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                          {slot.fixedProductId && !productResults[idx]?.length && (
                            <p className="text-xs text-muted-foreground">
                              Producto ID: {slot.fixedProductId}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  <Button variant="outline" onClick={addSlot} className="w-full">
                    <Plus className="h-4 w-4 mr-2" /> Agregar Slot
                  </Button>

                  <Separator />

                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => setEditing(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleSave} disabled={saving}>
                      {saving ? (
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Guardar
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar: price summary + config */}
        <div className="space-y-4">
          {/* Price summary */}
          <Card>
            <CardHeader>
              <CardTitle>Precio total</CardTitle>
            </CardHeader>
            <CardContent>
              {totalFromSlots != null ? (
                <>
                  <p className="text-4xl font-bold">
                    ${totalFromSlots.toLocaleString("es-AR", { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Suma de componentes al precio de venta individual
                  </p>
                </>
              ) : (
                <div className="text-center py-4 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-40" />
                  <p className="text-sm">
                    {combo.lastRefreshedAt
                      ? "Algún slot no pudo resolverse"
                      : "Presioná Actualizar para calcular"}
                  </p>
                </div>
              )}

              {combo.lastRefreshedAt && (
                <p className="text-xs text-muted-foreground mt-3">
                  Actualizado:{" "}
                  {new Date(combo.lastRefreshedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                </p>
              )}

              {/* Slot breakdown */}
              {resolution && (
                <>
                  <Separator className="my-3" />
                  <div className="space-y-1.5 text-sm">
                    {resolution.slots.map((s) => (
                      <div key={s.slotId} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground truncate">{s.slotName}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {s.resolvedPrice != null ? (
                            <>
                              {s.quantity > 1 && (
                                <span className="text-xs text-muted-foreground">
                                  ×{s.quantity}
                                </span>
                              )}
                              <span className="font-medium">
                                ${(s.resolvedPrice * s.quantity).toLocaleString("es-AR", {
                                  maximumFractionDigits: 0,
                                })}
                              </span>
                              {s.hasStock ? (
                                <CheckCircle className="h-3 w-3 text-green-600" />
                              ) : (
                                <XCircle className="h-3 w-3 text-red-500" />
                              )}
                            </>
                          ) : (
                            <span className="text-red-500 text-xs">Sin precio</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Configuración</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">SKU</p>
                <p className="font-mono font-medium">{combo.sku}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Producto vinculado</p>
                {combo.productId ? (
                  <Link href={`/products/${combo.productId}`} className="text-primary flex items-center gap-1 hover:underline">
                    Ver producto <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="text-muted-foreground">Sin vincular</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Creado</p>
                <p>{new Date(combo.createdAt).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</p>
              </div>

              <Separator />

              <Button
                variant="destructive"
                size="sm"
                className="w-full"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Eliminar combo
              </Button>
            </CardContent>
          </Card>

          {/* AI Description card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Descripción de tienda</CardTitle>
                {!isViewer && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateDescription}
                    disabled={generatingDesc}
                    className="h-7 text-xs gap-1.5"
                  >
                    {generatingDesc ? (
                      <RefreshCw className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    {generatingDesc ? "Generando..." : "Generar con IA"}
                  </Button>
                )}
              </div>
              <CardDescription className="text-xs">
                Se usa como descripción del producto en la tienda online.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Tab toggle — oculto para VIEWER */}
              {!isViewer && (
                <div className="flex gap-1 border rounded-md p-0.5 w-fit">
                  <button
                    onClick={() => setDescTab("edit")}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${descTab === "edit" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => setDescTab("preview")}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${descTab === "preview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    Vista previa
                  </button>
                </div>
              )}

              {!isViewer && descTab === "edit" ? (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={
                    generatingDesc
                      ? "Generando descripción con IA..."
                      : "Todavía no hay descripción. Hacé clic en 'Generar con IA' para crearla automáticamente."
                  }
                  className="text-sm min-h-[180px] resize-y font-mono"
                  disabled={generatingDesc}
                />
              ) : (
                <div
                  className="min-h-[180px] p-3 rounded-md border bg-muted/20 text-sm prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: description || "<p class='text-muted-foreground italic'>Sin descripción todavía.</p>" }}
                />
              )}

              <div className="flex gap-2">
                {!isViewer && (
                  <Button
                    size="sm"
                    onClick={handleSaveDescription}
                    disabled={savingDesc || generatingDesc}
                    className="flex-1"
                  >
                    {savingDesc ? (
                      <RefreshCw className="h-3 w-3 mr-1.5 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3 mr-1.5" />
                    )}
                    Guardar descripción
                  </Button>
                )}
                {description && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(description);
                      toast.success("Copiado al portapapeles");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
