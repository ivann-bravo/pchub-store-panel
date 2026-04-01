"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Trash2, ChevronUp, ChevronDown, RefreshCw, FileDown,
  Copy, LayoutTemplate, Pencil, Check, X, MessageCircle, ArrowLeft,
  Loader2, AlertCircle, FileText,
} from "lucide-react";
import { toast } from "sonner";
import type { QuoteSessionWithQuotes, QuoteItemType } from "@/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ItemState {
  id?: number;
  sortOrder: number;
  itemName: string;
  quantity: number;
  isOptional: boolean;
  itemType: QuoteItemType;
  filterCategory: string;
  filterKeywords: string;
  filterMustKeywords: string;
  filterSocket: string;
  filterMemoryType: string;
  filterMinPrice: string;
  filterMaxPrice: string;
  fixedProductId: number | null;
  fixedProductName: string;
  textPrice: string;
  textSku: string;
  resolvedProductId: number | null;
  resolvedProductName: string | null;
  resolvedProductSku: string | null;
  resolvedImageUrl: string | null;
  resolvedPrice: number | null;
  resolvedHasStock: boolean | null;
  resolvedAt: string | null;
  manualPrice: number | null;
  manualPriceNote: string | null;
  // ui state
  _productSearch: string;
  _productResults: { id: number; name: string; sku: string | null }[];
  _priceOverrideOpen: boolean;
  _overrideMode: "fixed" | "discount" | "surcharge";
  _overrideValue: string;
  _overrideNote: string;
}

const STATUS_LABELS: Record<string, string> = {
  open: "Abierto",
  following_up: "En seguimiento",
  closed_wc: "Cerrado WC",
  closed_wpp: "Cerrado WhatsApp",
  closed_other: "Cerrado otro",
  lost: "Perdido",
};

function roundToNine(price: number): number {
  const n = Math.ceil(price);
  return Math.ceil((n - 9) / 10) * 10 + 9;
}

function fmt(n: number) {
  return `$ ${roundToNine(n).toLocaleString("es-AR")}`;
}

function getEffectivePrice(item: ItemState): number | null {
  if (item.manualPrice != null) return item.manualPrice;
  if (item.itemType === "text") return item.textPrice ? parseFloat(item.textPrice) : null;
  return item.resolvedPrice;
}

function blankItem(sortOrder: number): ItemState {
  return {
    sortOrder,
    itemName: "",
    quantity: 1,
    isOptional: false,
    itemType: "auto",
    filterCategory: "",
    filterKeywords: "",
    filterMustKeywords: "",
    filterSocket: "",
    filterMemoryType: "",
    filterMinPrice: "",
    filterMaxPrice: "",
    fixedProductId: null,
    fixedProductName: "",
    textPrice: "",
    textSku: "",
    resolvedProductId: null,
    resolvedProductName: null,
    resolvedProductSku: null,
    resolvedImageUrl: null,
    resolvedPrice: null,
    resolvedHasStock: null,
    resolvedAt: null,
    manualPrice: null,
    manualPriceNote: null,
    _productSearch: "",
    _productResults: [],
    _priceOverrideOpen: false,
    _overrideMode: "fixed",
    _overrideValue: "",
    _overrideNote: "",
  };
}

function apiToItemState(item: QuoteSessionWithQuotes["quotes"][0]["items"][0], sortOrder: number): ItemState {
  const parseKwArr = (json: string | null): string => {
    try {
      const p = JSON.parse(json ?? "[]");
      return Array.isArray(p) ? p.join(", ") : "";
    } catch { return ""; }
  };
  let filterSocket = "";
  let filterMemoryType = "";
  if (item.filterAttributes) {
    try {
      const attrs = JSON.parse(item.filterAttributes);
      filterSocket = attrs.socket ?? "";
      filterMemoryType = attrs.memoryType ?? "";
    } catch { /* ignore */ }
  }
  return {
    id: item.id,
    sortOrder,
    itemName: item.itemName,
    quantity: item.quantity,
    isOptional: item.isOptional,
    itemType: item.itemType,
    filterCategory: item.filterCategory ?? "",
    filterKeywords: parseKwArr(item.filterKeywords),
    filterMustKeywords: parseKwArr(item.filterMustKeywords),
    filterSocket,
    filterMemoryType,
    filterMinPrice: item.filterMinPrice?.toString() ?? "",
    filterMaxPrice: item.filterMaxPrice?.toString() ?? "",
    fixedProductId: item.fixedProductId,
    fixedProductName: "",
    textPrice: item.textPrice?.toString() ?? "",
    textSku: item.textSku ?? "",
    resolvedProductId: item.resolvedProductId,
    resolvedProductName: item.resolvedProductName,
    resolvedProductSku: item.resolvedProductSku,
    resolvedImageUrl: item.resolvedImageUrl,
    resolvedPrice: item.resolvedPrice,
    resolvedHasStock: item.resolvedHasStock,
    resolvedAt: item.resolvedAt,
    manualPrice: item.manualPrice,
    manualPriceNote: item.manualPriceNote,
    _productSearch: "",
    _productResults: [],
    _priceOverrideOpen: false,
    _overrideMode: "fixed",
    _overrideValue: "",
    _overrideNote: "",
  };
}

function itemStateToPayload(item: ItemState) {
  const parseKw = (s: string) => s.split(",").map((k) => k.trim()).filter(Boolean);
  return {
    id: item.id,
    sortOrder: item.sortOrder,
    itemName: item.itemName,
    quantity: item.quantity,
    isOptional: item.isOptional,
    itemType: item.itemType,
    filterCategory: item.filterCategory || null,
    filterKeywords: item.filterKeywords ? JSON.stringify(parseKw(item.filterKeywords)) : null,
    filterMustKeywords: item.filterMustKeywords ? JSON.stringify(parseKw(item.filterMustKeywords)) : null,
    filterAttributes: (() => {
      const attrs: Record<string, string> = {};
      if (item.filterSocket) attrs.socket = item.filterSocket;
      if (item.filterMemoryType) attrs.memoryType = item.filterMemoryType;
      return Object.keys(attrs).length > 0 ? JSON.stringify(attrs) : null;
    })(),
    filterMinPrice: item.filterMinPrice ? parseFloat(item.filterMinPrice) : null,
    filterMaxPrice: item.filterMaxPrice ? parseFloat(item.filterMaxPrice) : null,
    fixedProductId: item.fixedProductId,
    textPrice: item.textPrice ? parseFloat(item.textPrice) : null,
    textSku: item.textSku || null,
    resolvedProductId: item.resolvedProductId,
    resolvedProductName: item.resolvedProductName,
    resolvedProductSku: item.resolvedProductSku,
    resolvedImageUrl: item.resolvedImageUrl,
    resolvedPrice: item.resolvedPrice,
    resolvedHasStock: item.resolvedHasStock,
    resolvedAt: item.resolvedAt,
    manualPrice: item.manualPrice,
    manualPriceNote: item.manualPriceNote,
  };
}

// ── ItemRow ────────────────────────────────────────────────────────────────────

interface ItemRowProps {
  item: ItemState;
  idx: number;
  total: number;
  categories: string[];
  onChange: (idx: number, updates: Partial<ItemState>) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRemove: (idx: number) => void;
}

function ItemRow({ item, idx, total, categories, onChange, onMove, onRemove }: ItemRowProps) {
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effectivePrice = getEffectivePrice(item);

  const searchProducts = (q: string) => {
    onChange(idx, { _productSearch: q });
    if (searchRef.current) clearTimeout(searchRef.current);
    if (q.length < 2) { onChange(idx, { _productResults: [] }); return; }
    searchRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(q)}&limit=6`);
        if (!res.ok) return;
        const data = await res.json() as { products: { id: number; name: string; sku: string | null }[] };
        onChange(idx, { _productResults: data.products ?? [] });
      } catch { /* ignore */ }
    }, 300);
  };

  const applyOverride = () => {
    const base = item.resolvedPrice ?? (item.textPrice ? parseFloat(item.textPrice) : null);
    const val = parseFloat(item._overrideValue);
    if (isNaN(val)) return;
    let newPrice: number;
    if (item._overrideMode === "fixed") newPrice = val;
    else if (item._overrideMode === "discount") newPrice = Math.round((base ?? 0) * (1 - val / 100));
    else newPrice = Math.round((base ?? 0) * (1 + val / 100));
    onChange(idx, {
      manualPrice: newPrice,
      manualPriceNote: item._overrideNote || null,
      _priceOverrideOpen: false,
      _overrideValue: "",
      _overrideNote: "",
    });
  };

  const previewPrice = (): number | null => {
    if (item._overrideMode === "fixed") return parseFloat(item._overrideValue) || null;
    const base = item.resolvedPrice ?? (item.textPrice ? parseFloat(item.textPrice) : null);
    if (!base || !item._overrideValue) return null;
    const val = parseFloat(item._overrideValue);
    if (isNaN(val)) return null;
    if (item._overrideMode === "discount") return Math.round(base * (1 - val / 100));
    return Math.round(base * (1 + val / 100));
  };

  return (
    <div className="border rounded-lg bg-card">
      {/* ── Item header row ── */}
      <div className="flex items-stretch gap-0">
        {/* Sort controls */}
        <div className="flex flex-col border-r">
          <button
            onClick={() => onMove(idx, -1)}
            disabled={idx === 0}
            className="flex-1 px-2 hover:bg-muted disabled:opacity-20 transition-colors"
            title="Subir"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onMove(idx, 1)}
            disabled={idx === total - 1}
            className="flex-1 px-2 hover:bg-muted disabled:opacity-20 transition-colors"
            title="Bajar"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Main content */}
        <div className="flex-1 p-3 space-y-3">
          {/* Row 1: name + controls */}
          <div className="flex items-center gap-3">
            <Input
              value={item.itemName}
              onChange={(e) => onChange(idx, { itemName: e.target.value })}
              placeholder="Nombre del ítem (ej: Procesador)"
              className="flex-1 font-medium"
            />
            <Select
              value={item.itemType}
              onValueChange={(v) => onChange(idx, { itemType: v as QuoteItemType })}
            >
              <SelectTrigger className="w-28 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="fixed">Fijo</SelectItem>
                <SelectItem value="text">Texto</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 shrink-0">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Cantidad</Label>
              <Input
                type="number"
                min={1}
                value={item.quantity}
                onChange={(e) => onChange(idx, { quantity: parseInt(e.target.value) || 1 })}
                className="w-16 text-center"
              />
            </div>
            <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={item.isOptional}
                onChange={(e) => onChange(idx, { isOptional: e.target.checked })}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm text-muted-foreground">Opcional</span>
            </label>
            <button
              onClick={() => onRemove(idx)}
              className="text-muted-foreground hover:text-destructive transition-colors p-1.5 rounded"
              title="Eliminar ítem"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {/* ── Auto slot filters ── */}
          {item.itemType === "auto" && (
            <div className="space-y-3 pt-2 border-t">
              {/* Row 1: Category + Keywords + Must keywords */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Categoría</Label>
                  <Select
                    value={item.filterCategory || "_none"}
                    onValueChange={(v) => onChange(idx, { filterCategory: v === "_none" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Elegir categoría…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">— Sin categoría —</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Palabras clave <span className="text-muted-foreground/60">(separadas por coma)</span>
                  </Label>
                  <Input
                    value={item.filterKeywords}
                    onChange={(e) => onChange(idx, { filterKeywords: e.target.value })}
                    placeholder="Ej: Ryzen 5, 8GB"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Palabras obligatorias <span className="text-muted-foreground/60">(separadas por coma)</span>
                  </Label>
                  <Input
                    value={item.filterMustKeywords}
                    onChange={(e) => onChange(idx, { filterMustKeywords: e.target.value })}
                    placeholder="Ej: AM5, DDR5"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
              {/* Row 2: Socket + Memory type + Price range */}
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Socket</Label>
                  <Select
                    value={item.filterSocket || "any"}
                    onValueChange={(v) => onChange(idx, { filterSocket: v === "any" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
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
                  <Label className="text-xs text-muted-foreground">Tipo de memoria</Label>
                  <Select
                    value={item.filterMemoryType || "any"}
                    onValueChange={(v) => onChange(idx, { filterMemoryType: v === "any" ? "" : v })}
                  >
                    <SelectTrigger className="h-8 text-sm">
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
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Precio mínimo</Label>
                  <Input
                    type="number"
                    value={item.filterMinPrice}
                    onChange={(e) => onChange(idx, { filterMinPrice: e.target.value })}
                    placeholder="0"
                    className="h-8 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Precio máximo</Label>
                  <Input
                    type="number"
                    value={item.filterMaxPrice}
                    onChange={(e) => onChange(idx, { filterMaxPrice: e.target.value })}
                    placeholder="Sin límite"
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── Fixed slot ── */}
          {item.itemType === "fixed" && (
            <div className="pt-1 border-t relative space-y-1">
              <Label className="text-xs text-muted-foreground">Buscar producto</Label>
              <Input
                value={item._productSearch || (item.fixedProductId ? item.fixedProductName || `#${item.fixedProductId}` : "")}
                onChange={(e) => searchProducts(e.target.value)}
                placeholder="Buscar por nombre o SKU..."
                className="h-8 text-sm"
              />
              {item._productResults.length > 0 && (
                <div className="absolute z-10 top-full left-0 right-0 border rounded-lg bg-popover shadow-lg divide-y text-sm overflow-hidden">
                  {item._productResults.map((p) => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                      onClick={() => onChange(idx, {
                        fixedProductId: p.id,
                        fixedProductName: p.name,
                        _productSearch: "",
                        _productResults: [],
                      })}
                    >
                      <span className="font-medium">{p.name}</span>
                      {p.sku && <span className="text-muted-foreground ml-2 text-xs">{p.sku}</span>}
                    </button>
                  ))}
                </div>
              )}
              {item.fixedProductId && !item._productResults.length && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Check className="h-3 w-3 text-green-500" />
                  {item.fixedProductName || `Producto #${item.fixedProductId}`}
                  <button
                    className="ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => onChange(idx, { fixedProductId: null, fixedProductName: "" })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </p>
              )}
            </div>
          )}

          {/* ── Text slot ── */}
          {item.itemType === "text" && (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Precio</Label>
                <Input
                  type="number"
                  value={item.textPrice}
                  onChange={(e) => onChange(idx, { textPrice: e.target.value })}
                  placeholder="0"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">SKU / Descripción (opcional)</Label>
                <Input
                  value={item.textSku}
                  onChange={(e) => onChange(idx, { textSku: e.target.value })}
                  placeholder="ARMADO, ENVÍO, etc."
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Resolved result ── */}
      {(item.resolvedProductName ?? item.resolvedAt) && (
        <div className="border-t bg-muted/30 px-3 py-2 flex items-center gap-3">
          {item.resolvedImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.resolvedImageUrl}
              alt=""
              className="h-9 w-9 object-contain rounded border bg-white flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {item.resolvedProductName ?? item.itemName}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs font-medium ${item.resolvedHasStock ? "text-green-600" : "text-red-500"}`}>
                {item.resolvedHasStock ? "✓ Con stock" : "✗ Sin stock"}
              </span>
              {item.resolvedProductSku && (
                <span className="text-xs text-muted-foreground">{item.resolvedProductSku}</span>
              )}
              {item.manualPriceNote && (
                <span className="text-xs italic text-muted-foreground">{item.manualPriceNote}</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            {item.manualPrice != null && item.resolvedPrice != null && item.manualPrice !== item.resolvedPrice && (
              <p className="text-xs line-through text-muted-foreground">{fmt(item.resolvedPrice)}</p>
            )}
            {effectivePrice != null ? (
              <p className="text-sm font-bold">{fmt(effectivePrice)}</p>
            ) : (
              <p className="text-xs text-muted-foreground italic">A confirmar</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onChange(idx, { _priceOverrideOpen: !item._priceOverrideOpen })}
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Ajustar precio"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {item.manualPrice != null && (
              <button
                onClick={() => onChange(idx, { manualPrice: null, manualPriceNote: null })}
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                title="Quitar ajuste de precio"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Price override panel ── */}
      {item._priceOverrideOpen && (
        <div className="border-t bg-muted/20 p-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ajustar precio</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Tipo de ajuste</Label>
              <Select
                value={item._overrideMode}
                onValueChange={(v) => onChange(idx, { _overrideMode: v as ItemState["_overrideMode"] })}
              >
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Precio fijo ($)</SelectItem>
                  <SelectItem value="discount">Descuento (%)</SelectItem>
                  <SelectItem value="surcharge">Aumento (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                {item._overrideMode === "fixed" ? "Precio final" : "Porcentaje"}
              </Label>
              <Input
                type="number"
                className="h-8 text-sm"
                value={item._overrideValue}
                onChange={(e) => onChange(idx, { _overrideValue: e.target.value })}
                placeholder={item._overrideMode === "fixed" ? "Ej: 85000" : "Ej: 10"}
                onKeyDown={(e) => e.key === "Enter" && applyOverride()}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nota (opcional)</Label>
              <Input
                className="h-8 text-sm"
                value={item._overrideNote}
                onChange={(e) => onChange(idx, { _overrideNote: e.target.value })}
                placeholder="Ej: descuento especial"
              />
            </div>
          </div>

          {/* Preview */}
          {item._overrideValue && previewPrice() != null && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Resultado:</span>
              <span className="font-bold text-primary">{fmt(previewPrice()!)}</span>
              {item.resolvedPrice != null && item._overrideMode !== "fixed" && (
                <span className="text-muted-foreground text-xs">
                  (antes: {fmt(item.resolvedPrice)})
                </span>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button size="sm" onClick={applyOverride} disabled={!item._overrideValue}>
              <Check className="h-3.5 w-3.5 mr-1" />
              Aplicar
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange(idx, { _priceOverrideOpen: false, _overrideValue: "", _overrideNote: "" })}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── QuoteEditor ────────────────────────────────────────────────────────────────

interface QuoteEditorProps {
  quote: QuoteSessionWithQuotes["quotes"][0];
  categories: string[];
  onQuoteUpdated: () => void;
  onDelete: () => void;
}

function QuoteEditor({ quote, categories, onQuoteUpdated, onDelete }: QuoteEditorProps) {
  const [title, setTitle] = useState(quote.title);
  const [notes, setNotes] = useState(quote.notes ?? "");
  const [items, setItems] = useState<ItemState[]>(
    quote.items.map((item, idx) => apiToItemState(item, idx))
  );
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const updateItem = useCallback((idx: number, updates: Partial<ItemState>) => {
    setItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...updates } : item));
    // Mark dirty only for meaningful changes (not UI-only state)
    const uiKeys = new Set(["_productSearch", "_productResults", "_priceOverrideOpen", "_overrideMode", "_overrideValue", "_overrideNote"]);
    if (!Object.keys(updates).every((k) => uiKeys.has(k))) setDirty(true);
  }, []);

  const moveItem = useCallback((idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next.map((item, i) => ({ ...item, sortOrder: i }));
    });
    setDirty(true);
  }, []);

  const removeItem = useCallback((idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx).map((item, i) => ({ ...item, sortOrder: i })));
    setDirty(true);
  }, []);

  const addItem = () => {
    setItems((prev) => [...prev, blankItem(prev.length)]);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || quote.title,
          notes: notes.trim() || null,
          items: items.map(itemStateToPayload),
        }),
      });
      if (!res.ok) throw new Error();
      setDirty(false);
      toast.success("Guardado");
      onQuoteUpdated();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const resolve = async () => {
    // Save first silently
    setSaving(true);
    try {
      await fetch(`/api/quotes/${quote.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), notes: notes.trim() || null, items: items.map(itemStateToPayload) }),
      });
      setDirty(false);
    } catch { /* ignore */ } finally { setSaving(false); }

    setResolving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/resolve`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json() as {
        items: QuoteSessionWithQuotes["quotes"][0]["items"];
        resolvedTotal: number | null;
      };
      setItems(data.items.map((item, idx) => apiToItemState(item, idx)));
      toast.success("Precios actualizados");
      onQuoteUpdated();
    } catch {
      toast.error("Error al resolver precios");
    } finally {
      setResolving(false);
    }
  };

  const applyTemplate = async () => {
    if (!confirm("¿Reemplazar los ítems con la plantilla PC? Se perderán los ítems actuales.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/apply-pc-template`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json() as { items: QuoteSessionWithQuotes["quotes"][0]["items"] };
      setItems(data.items.map((item, idx) => apiToItemState(item, idx)));
      setDirty(false);
      toast.success("Plantilla PC aplicada — completá los filtros");
    } catch {
      toast.error("Error al aplicar plantilla");
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Opción duplicada");
      onQuoteUpdated();
    } catch {
      toast.error("Error al duplicar");
    } finally {
      setSaving(false);
    }
  };

  const deleteQuote = async () => {
    if (!confirm("¿Eliminar esta opción? Esta acción no se puede deshacer.")) return;
    await fetch(`/api/quotes/${quote.id}`, { method: "DELETE" });
    onDelete();
  };

  const nonOptional = items.filter((i) => !i.isOptional);
  const resolvedItems = nonOptional.filter((i) => getEffectivePrice(i) != null);
  const total = resolvedItems.reduce((s, i) => s + (getEffectivePrice(i)! * i.quantity), 0);
  const allPriced = nonOptional.length > 0 && resolvedItems.length === nonOptional.length;

  return (
    <div className="space-y-4">
      {/* Title + actions */}
      <div className="flex gap-3 items-start">
        <div className="flex-1 space-y-1">
          <Label>Título de la opción</Label>
          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="font-medium"
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-6 shrink-0">
          <Button size="sm" variant="outline" onClick={applyTemplate} disabled={saving || resolving} title="Aplicar plantilla PC">
            <LayoutTemplate className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Plantilla PC</span>
          </Button>
          <Button size="sm" variant="outline" onClick={resolve} disabled={resolving || saving} title="Actualizar precios">
            {resolving
              ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" />
              : <RefreshCw className="h-3.5 w-3.5 sm:mr-1.5" />}
            <span className="hidden sm:inline">{resolving ? "Resolviendo..." : "Resolver precios"}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={duplicate} disabled={saving || resolving} title="Duplicar opción">
            <Copy className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Duplicar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")} title="Descargar PDF">
            <FileDown className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">PDF</span>
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={saving}
            className={dirty ? "ring-2 ring-primary/40" : ""}
          >
            {saving
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Check className="h-3.5 w-3.5 mr-1.5" />}
            {saving ? "Guardando..." : "Guardar"}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={deleteQuote}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {dirty && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          Hay cambios sin guardar
        </p>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <Label className="text-sm text-muted-foreground">Notas de esta opción</Label>
        <Textarea
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
          rows={2}
          className="resize-none text-sm"
          placeholder="Detalles específicos de esta opción..."
        />
      </div>

      {/* Total */}
      {(allPriced || resolvedItems.length > 0) && (
        <div className="flex items-center justify-end gap-3 py-2 px-4 rounded-lg bg-primary/5 border border-primary/20">
          {!allPriced && (
            <span className="text-xs text-muted-foreground">
              {resolvedItems.length}/{nonOptional.length} ítems con precio
            </span>
          )}
          <span className="text-sm text-muted-foreground">Total al contado:</span>
          <span className="text-lg font-bold text-primary">{fmt(total)}</span>
          <span className="text-xs text-muted-foreground">(sin opcionales)</span>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
            <p className="text-sm">Esta opción no tiene ítems todavía.</p>
            <p className="text-xs mt-1">Usá &quot;Plantilla PC&quot; para empezar rápido, o agregá ítems manualmente.</p>
          </div>
        )}
        {items.map((item, idx) => (
          <ItemRow
            key={idx}
            item={item}
            idx={idx}
            total={items.length}
            categories={categories}
            onChange={updateItem}
            onMove={moveItem}
            onRemove={removeItem}
          />
        ))}
      </div>

      <Button variant="outline" onClick={addItem} className="w-full gap-2">
        <Plus className="h-4 w-4" />
        Agregar ítem
      </Button>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PresupuestoDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<QuoteSessionWithQuotes | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("");
  const [savingSession, setSavingSession] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);

  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [status, setStatus] = useState("open");
  const [wcOrderId, setWcOrderId] = useState("");
  const [closedNotes, setClosedNotes] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/quote-sessions/${params.id}`);
      if (!res.ok) { router.push("/presupuestos"); return; }
      const d: QuoteSessionWithQuotes = await res.json();
      setData(d);
      setClientName(d.clientName);
      setClientPhone(d.clientPhone ?? "");
      setClientEmail(d.clientEmail ?? "");
      setStatus(d.status);
      setWcOrderId(d.wcOrderId ?? "");
      setClosedNotes(d.closedNotes ?? "");
      setSessionNotes(d.notes ?? "");
      if (d.quotes.length > 0 && !activeTab) {
        setActiveTab(String(d.quotes[0].id));
      }
    } finally {
      setLoading(false);
    }
  }, [params.id, router, activeTab]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    fetch("/api/products/categories")
      .then((r) => r.json())
      .then((rows: { category: string }[]) => setCategories(rows.map((r) => r.category)))
      .catch(() => {/* ignore */});
  }, []);

  const saveSession = async () => {
    setSavingSession(true);
    try {
      const res = await fetch(`/api/quote-sessions/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientPhone: clientPhone.trim() || null,
          clientEmail: clientEmail.trim() || null,
          status,
          wcOrderId: wcOrderId.trim() || null,
          closedNotes: closedNotes.trim() || null,
          notes: sessionNotes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Datos del cliente guardados");
      load();
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSavingSession(false);
    }
  };

  const addQuote = async () => {
    const res = await fetch(`/api/quote-sessions/${params.id}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const q = await res.json() as { id: number };
      setActiveTab(String(q.id));
      load();
    }
  };

  const getWhatsAppLink = () => {
    if (!data?.clientPhone) return null;
    const phone = data.clientPhone.replace(/\D/g, "");
    const fullPhone = phone.startsWith("54") ? phone : `54${phone}`;
    const n = data.quotes.length;
    const msg = n <= 1
      ? `Hola ${data.clientName}, ¿pudiste ver el presupuesto que te armamos? ¿Tenés alguna duda o querés cambiar algo?`
      : `Hola ${data.clientName}, te preparamos ${n} opciones para tu compra. ¿Pudiste verlas? ¿Querés que te ayudemos a elegir entre ellas o ajustar algo?`;
    return `https://wa.me/${fullPhone}?text=${encodeURIComponent(msg)}`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Cargando presupuesto...</span>
      </div>
    );
  }

  if (!data) return null;

  const waLink = getWhatsAppLink();
  const isClosedOrLost = status.startsWith("closed") || status === "lost";

  return (
    <div className="max-w-screen-xl mx-auto p-6 space-y-5">
      {/* ── Breadcrumb / header ── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/presupuestos")} className="gap-1.5 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          Presupuestos
        </Button>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-lg font-semibold">{data.clientName}</h1>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
          status === "open" ? "bg-muted text-muted-foreground" :
          status === "following_up" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" :
          status.startsWith("closed") ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400" :
          "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
        }`}>
          {STATUS_LABELS[status] ?? status}
        </span>
        <div className="ml-auto flex gap-2">
          {waLink && (
            <a href={waLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </Button>
            </a>
          )}
          {data.quotes.length > 0 && (
            <Button variant="outline" size="sm" className="gap-2" onClick={() => window.open(`/api/quote-sessions/${params.id}/pdf`, "_blank")}>
              <FileDown className="h-4 w-4" />
              {data.quotes.length === 1 ? "Descargar PDF" : `PDF con ${data.quotes.length} opciones`}
            </Button>
          )}
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-[340px,1fr] gap-6 items-start">

        {/* ── Left: client card ── */}
        <div className="space-y-4 border rounded-xl p-4 bg-card shadow-sm">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Datos del cliente</h2>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="s-name">Nombre</Label>
              <Input id="s-name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-phone">Teléfono</Label>
              <Input id="s-phone" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder="11 1234-5678" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s-email">Email</Label>
              <Input id="s-email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} type="email" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="s-status">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="s-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isClosedOrLost && (
              <>
                {status === "closed_wc" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="s-wc">Nro. Orden WooCommerce</Label>
                    <Input id="s-wc" value={wcOrderId} onChange={(e) => setWcOrderId(e.target.value)} placeholder="#12345" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="s-closed-notes">Notas de cierre</Label>
                  <Textarea
                    id="s-closed-notes"
                    value={closedNotes}
                    onChange={(e) => setClosedNotes(e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                    placeholder="Cómo cerró la venta..."
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="s-notes">Notas internas</Label>
              <Textarea
                id="s-notes"
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                rows={3}
                className="resize-none text-sm"
                placeholder="Observaciones sobre este cliente / oportunidad..."
              />
            </div>
          </div>

          <Button className="w-full" onClick={saveSession} disabled={savingSession}>
            {savingSession ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Guardar datos
          </Button>

          <div className="pt-2 border-t text-xs text-muted-foreground space-y-1">
            {data.exchangeRateAtCreation && (
              <p>TC al crear: <span className="font-medium">${data.exchangeRateAtCreation.toFixed(2)}</span></p>
            )}
            <p>Creado: {new Date(data.createdAt).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })}</p>
          </div>
        </div>

        {/* ── Right: quotes ── */}
        <div className="space-y-4 min-w-0">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Opciones del presupuesto</h2>
            <Button size="sm" variant="outline" onClick={addQuote} className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              Nueva opción
            </Button>
          </div>

          {data.quotes.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed rounded-xl text-muted-foreground space-y-3">
              <FileText className="h-10 w-10 mx-auto opacity-30" />
              <p className="font-medium">Sin opciones todavía</p>
              <p className="text-sm">Creá una opción o aplicá la plantilla de PC completa</p>
              <Button variant="outline" size="sm" onClick={addQuote} className="gap-2 mx-auto">
                <Plus className="h-3.5 w-3.5" />
                Crear primera opción
              </Button>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex-wrap h-auto gap-1 w-full justify-start">
                {data.quotes.map((q) => (
                  <TabsTrigger key={q.id} value={String(q.id)} className="gap-1.5">
                    <span>{q.title}</span>
                    {q.resolvedTotal != null && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
                        {`$ ${Math.round(q.resolvedTotal).toLocaleString("es-AR")}`}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>

              {data.quotes.map((q) => (
                <TabsContent key={q.id} value={String(q.id)} className="mt-4">
                  <QuoteEditor
                    quote={q}
                    categories={categories}
                    onQuoteUpdated={load}
                    onDelete={() => {
                      const remaining = data.quotes.filter((x) => x.id !== q.id);
                      setActiveTab(remaining.length > 0 ? String(remaining[0].id) : "");
                      load();
                    }}
                  />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
