"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Save,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface SlotDraft {
  slotName: string;
  slotType: "auto" | "fixed";
  quantity: number;
  filterCategory: string;
  filterKeywords: string; // comma-separated
  fixedProductId: number | null;
  fixedProductName: string;
}

const SLOT_PRESETS = [
  { name: "CPU", type: "auto" as const },
  { name: "Placa Madre", type: "auto" as const },
  { name: "RAM", type: "auto" as const },
  { name: "Almacenamiento", type: "auto" as const },
  { name: "Servicio", type: "fixed" as const },
];

export default function NewComboPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace("/combos");
    }
  }, [session, status, router]);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("PCTRY");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<SlotDraft[]>([
    { slotName: "CPU", slotType: "auto", quantity: 1, filterCategory: "", filterKeywords: "", fixedProductId: null, fixedProductName: "" },
  ]);
  const [saving, setSaving] = useState(false);

  // Product search for fixed slots
  const [productSearch, setProductSearch] = useState<Record<number, string>>({});
  const [productResults, setProductResults] = useState<Record<number, { id: number; name: string; sku: string | null }[]>>({});

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      { slotName: "", slotType: "auto", quantity: 1, filterCategory: "", filterKeywords: "", fixedProductId: null, fixedProductName: "" },
    ]);
  };

  const addPreset = (preset: (typeof SLOT_PRESETS)[number]) => {
    setSlots((prev) => [
      ...prev,
      { slotName: preset.name, slotType: preset.type, quantity: 1, filterCategory: "", filterKeywords: "", fixedProductId: null, fixedProductName: "" },
    ]);
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, patch: Partial<SlotDraft>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

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

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Ingresá un nombre"); return; }
    if (!sku.trim()) { toast.error("Ingresá un SKU"); return; }
    if (slots.length === 0) { toast.error("Agregá al menos un slot"); return; }

    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        notes: notes.trim() || null,
        slots: slots.map((s, i) => ({
          slotName: s.slotName,
          slotType: s.slotType,
          quantity: s.quantity,
          sortOrder: i,
          fixedProductId: s.slotType === "fixed" ? s.fixedProductId : null,
          filterCategory: s.slotType === "auto" ? s.filterCategory : null,
          filterKeywords:
            s.slotType === "auto" && s.filterKeywords
              ? s.filterKeywords.split(",").map((k) => k.trim()).filter(Boolean)
              : null,
        })),
      };

      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al crear combo");

      toast.success(`Combo ${data.sku} creado`);
      router.push(`/combos/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear combo");
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/combos">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Nuevo Combo</h1>
          <p className="text-sm text-muted-foreground">
            Configurá los slots de componentes. Los slots &quot;auto&quot; seleccionan el producto más barato en stock.
          </p>
        </div>
      </div>

      {/* Basic info */}
      <Card>
        <CardHeader>
          <CardTitle>Datos básicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nombre</Label>
              <Input
                id="name"
                placeholder="ej: PC Gamer Entry AMD"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sku">SKU (código PCTRY)</Label>
              <Input
                id="sku"
                placeholder="PCTRY1001"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Se guarda en mayúsculas automáticamente
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Descripción del combo, especificaciones, etc."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Slots */}
      <Card>
        <CardHeader>
          <CardTitle>Slots de componentes</CardTitle>
          <CardDescription>
            <strong>Auto:</strong> busca el producto más barato en stock en una categoría con palabras clave.<br />
            <strong>Fijo:</strong> siempre usa el mismo producto específico.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Presets */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs text-muted-foreground self-center">Agregar:</span>
            {SLOT_PRESETS.map((p) => (
              <Button key={p.name} variant="outline" size="sm" onClick={() => addPreset(p)}>
                <Plus className="h-3 w-3 mr-1" /> {p.name}
              </Button>
            ))}
          </div>

          <Separator />

          {slots.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hay slots. Usá los accesos rápidos o el botón &quot;Agregar Slot&quot;.
            </p>
          )}

          {slots.map((slot, idx) => (
            <div key={idx} className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground w-6">{idx + 1}.</span>
                <Input
                  placeholder="Nombre del slot (ej: CPU)"
                  value={slot.slotName}
                  onChange={(e) => updateSlot(idx, { slotName: e.target.value })}
                  className="flex-1"
                />
                <Select
                  value={slot.slotType}
                  onValueChange={(v) =>
                    updateSlot(idx, { slotType: v as "auto" | "fixed" })
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto</SelectItem>
                    <SelectItem value="fixed">Fijo</SelectItem>
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

              {slot.slotType === "auto" ? (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div className="space-y-1">
                    <Label className="text-xs">Categoría del producto</Label>
                    <Input
                      placeholder="ej: Procesadores"
                      value={slot.filterCategory}
                      onChange={(e) =>
                        updateSlot(idx, { filterCategory: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Debe coincidir exactamente con la categoría en el catálogo
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Palabras clave (separadas por coma)</Label>
                    <Input
                      placeholder="ej: AM4, Ryzen"
                      value={slot.filterKeywords}
                      onChange={(e) =>
                        updateSlot(idx, { filterKeywords: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      El nombre del producto debe contener TODAS las palabras
                    </p>
                  </div>
                </div>
              ) : (
                <div className="pl-6 space-y-1 relative">
                  <Label className="text-xs">Producto fijo</Label>
                  <Input
                    placeholder="Buscar producto por nombre o SKU..."
                    value={productSearch[idx] ?? slot.fixedProductName}
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
                            <span className="text-xs text-muted-foreground font-mono">{p.sku}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {slot.fixedProductId && (
                    <p className="text-xs text-green-600">
                      Producto seleccionado: {slot.fixedProductName || `ID ${slot.fixedProductId}`}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}

          <Button variant="outline" onClick={addSlot} className="w-full">
            <Plus className="h-4 w-4 mr-2" /> Agregar Slot
          </Button>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex gap-3 justify-end">
        <Link href="/combos">
          <Button variant="ghost">Cancelar</Button>
        </Link>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          {saving ? "Guardando..." : "Crear Combo"}
        </Button>
      </div>
    </div>
  );
}
