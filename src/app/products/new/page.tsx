"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { WooCategoryPicker } from "@/components/woo-category-picker";

export default function NewProductPage() {
  return (
    <Suspense fallback={<div className="h-64 bg-muted animate-pulse rounded" />}>
      <NewProductContent />
    </Suspense>
  );
}

function NewProductContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const [saving, setSaving] = useState(false);
  const [publishToWoo, setPublishToWoo] = useState(false);
  const [extraAttributes, setExtraAttributes] = useState<{ panelKey: string; label: string; value: string }[]>([]);

  // Pre-fill from search params (from match page)
  const prefillName = searchParams.get("name") || "";
  const prefillSku = searchParams.get("sku") || "";
  const catalogItemId = searchParams.get("catalogItemId") || "";
  const supplierId = searchParams.get("supplierId") || "";

  const [form, setForm] = useState({
    name: prefillName,
    sku: prefillSku,
    eanUpc: "",
    category: "",
    brand: "",
    warranty: "",
    ivaRate: 0.21,
    markupRegular: 1.12,
    localStock: 0,
    woocommerceId: "",
    wooCategoryId: null as number | null,
    wooCategoryIds: "",
    weightKg: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    imageUrl: "",
    storeUrl: "",
    description: "",
  });

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace("/products");
    }
  }, [session, status, router]);

  // Load WC attribute mappings for the extra attributes section
  const AUTO_KEYS = new Set(["brand", "warranty", "iva"]);
  useEffect(() => {
    fetch("/api/woocommerce/attribute-mappings")
      .then((r) => r.json())
      .then((rows: { panelKey: string; wooAttributeName: string }[]) => {
        const filtered = rows
          .filter((m) => !AUTO_KEYS.has(m.panelKey))
          .map((m) => ({ panelKey: m.panelKey, label: m.wooAttributeName, value: "" }));
        setExtraAttributes(filtered);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  const update = (field: string, value: string | number) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          wooCategoryId: undefined, // internal only, not sent to API
          wooCategoryIds: form.wooCategoryIds || null,
          weightKg: form.weightKg ? parseFloat(form.weightKg) : null,
          lengthCm: form.lengthCm ? parseFloat(form.lengthCm) : null,
          widthCm: form.widthCm ? parseFloat(form.widthCm) : null,
          heightCm: form.heightCm ? parseFloat(form.heightCm) : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();

        // Auto-link catalog item if we came from match page
        if (catalogItemId && supplierId) {
          try {
            await fetch(`/api/suppliers/${supplierId}/catalog`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                itemId: parseInt(catalogItemId),
                productId: data.id,
              }),
            });
          } catch {}
        }

        // Publish to WooCommerce if requested
        if (publishToWoo) {
          try {
            const wooRes = await fetch("/api/woocommerce/create-product", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                productId: data.id,
                extraAttributes: extraAttributes
                  .filter((a) => a.value.trim())
                  .map((a) => ({ panelKey: a.panelKey, value: a.value.trim() })),
              }),
            });
            if (wooRes.ok) {
              const woo = await wooRes.json() as { woocommerceId: number };
              toast.success(`Producto creado en WooCommerce (ID ${woo.woocommerceId})`);

              // Process and upload images with WebP conversion + correct filename/alt
              const urlParts = form.imageUrl.split(",").map((u) => u.trim()).filter(Boolean);
              if (urlParts.length > 0) {
                const [mainUrl, ...galleryUrls] = urlParts;
                let imgOk = 0;
                const imgErrors: string[] = [];

                // Main image
                try {
                  const imgRes = await fetch("/api/images/process", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ productId: data.id, target: "main", newUrl: mainUrl, forceConvert: true }),
                  });
                  if (imgRes.ok) { imgOk++; }
                  else { const e = await imgRes.json() as { error: string }; imgErrors.push(e.error); }
                } catch { imgErrors.push("Error de red (imagen principal)"); }

                // Gallery images (sequential — each updates DB state read by next)
                for (let i = 0; i < galleryUrls.length; i++) {
                  try {
                    const imgRes = await fetch("/api/images/process", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ productId: data.id, target: "gallery", galleryIndex: i, newUrl: galleryUrls[i], forceConvert: true }),
                    });
                    if (imgRes.ok) { imgOk++; }
                    else { const e = await imgRes.json() as { error: string }; imgErrors.push(e.error); }
                  } catch { imgErrors.push(`Error de red (galería ${i + 1})`); }
                }

                if (imgErrors.length > 0) {
                  toast.error(`Imagen(es) con error: ${imgErrors.join(", ")}`);
                } else {
                  toast.success(`${imgOk} imagen(es) optimizada(s) y subida(s) a WooCommerce`);
                }
              }
            } else {
              const err = await wooRes.json() as { error: string };
              toast.success("Producto creado en el panel");
              toast.error(`Error al publicar en WooCommerce: ${err.error}`);
            }
          } catch {
            toast.success("Producto creado en el panel");
            toast.error("Error al conectar con WooCommerce");
          }
        } else {
          toast.success(catalogItemId ? "Producto creado y vinculado" : "Producto creado");
        }

        router.push(`/products/${data.id}`);
      } else {
        toast.error("Error al crear producto");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <h1 className="text-2xl font-bold">Nuevo Producto</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Información del Producto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nombre *</Label>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>SKU</Label>
              <Input value={form.sku} onChange={(e) => update("sku", e.target.value)} />
            </div>
            <div>
              <Label>EAN/UPC</Label>
              <Input value={form.eanUpc} onChange={(e) => update("eanUpc", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Categoría (panel)</Label>
              <Input value={form.category} onChange={(e) => update("category", e.target.value)} />
            </div>
            <div>
              <Label>Marca</Label>
              <Input value={form.brand} onChange={(e) => update("brand", e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Categoría WooCommerce</Label>
            <WooCategoryPicker
              value={form.wooCategoryId}
              onChange={(id, allIds) => setForm((f) => ({
                ...f,
                wooCategoryId: id,
                wooCategoryIds: allIds.length > 0 ? JSON.stringify(allIds) : "",
              }))}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>IVA</Label>
              <Input type="number" step="0.001" value={form.ivaRate} onChange={(e) => update("ivaRate", parseFloat(e.target.value) || 0.21)} />
            </div>
            <div>
              <Label>Markup Regular</Label>
              <Input type="number" step="0.01" value={form.markupRegular} onChange={(e) => update("markupRegular", parseFloat(e.target.value) || 1)} />
            </div>
            <div>
              <Label>Stock Local</Label>
              <Input type="number" value={form.localStock} onChange={(e) => update("localStock", parseInt(e.target.value) || 0)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Garantía</Label>
              <Input value={form.warranty} onChange={(e) => update("warranty", e.target.value)} />
            </div>
            <div>
              <Label>WooCommerce ID</Label>
              <Input type="number" value={form.woocommerceId} onChange={(e) => update("woocommerceId", e.target.value)} placeholder="Sin ID" />
            </div>
          </div>
          <div>
            <Label>URL Imagen</Label>
            <Input value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} placeholder="https://... (separar múltiples con coma)" />
          </div>
          <div>
            <Label>URL Tienda</Label>
            <Input value={form.storeUrl} onChange={(e) => update("storeUrl", e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea rows={4} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Opcional — podés generarla con IA desde el detalle del producto después de crearlo." />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <Label>Peso (kg)</Label>
              <Input type="number" step="0.1" value={form.weightKg} onChange={(e) => update("weightKg", e.target.value)} />
            </div>
            <div>
              <Label>Largo (cm)</Label>
              <Input type="number" step="0.1" value={form.lengthCm} onChange={(e) => update("lengthCm", e.target.value)} />
            </div>
            <div>
              <Label>Ancho (cm)</Label>
              <Input type="number" step="0.1" value={form.widthCm} onChange={(e) => update("widthCm", e.target.value)} />
            </div>
            <div>
              <Label>Alto (cm)</Label>
              <Input type="number" step="0.1" value={form.heightCm} onChange={(e) => update("heightCm", e.target.value)} />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-md border border-input bg-muted/30 px-3 py-2">
            <input
              id="publish-to-woo"
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary cursor-pointer"
              checked={publishToWoo}
              onChange={(e) => setPublishToWoo(e.target.checked)}
            />
            <label htmlFor="publish-to-woo" className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" />
              Crear también en WooCommerce
            </label>
          </div>

          {publishToWoo && extraAttributes.length > 0 && (
            <div className="space-y-3 rounded-md border border-input p-3">
              <p className="text-sm font-medium">Atributos WooCommerce</p>
              <p className="text-xs text-muted-foreground">Marca, garantía e IVA se agregan automáticamente desde los campos del formulario.</p>
              <div className="grid grid-cols-2 gap-3">
                {extraAttributes.map((attr) => (
                  <div key={attr.panelKey}>
                    <Label className="text-xs">{attr.label}</Label>
                    <Input
                      value={attr.value}
                      onChange={(e) => setExtraAttributes((prev) =>
                        prev.map((a) => a.panelKey === attr.panelKey ? { ...a, value: e.target.value } : a)
                      )}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" /> {saving ? "Guardando..." : "Crear Producto"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
