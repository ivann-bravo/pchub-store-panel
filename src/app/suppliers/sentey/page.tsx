"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Package,
  Link2,
  Settings,
  Save,
  ExternalLink,
  Lock,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";

interface SenteyInfo {
  exists: boolean;
  supplier?: {
    id: number;
    code: string;
    name: string;
    currency: string;
    taxRate: number;
    stockConfig: string | null;
  };
  linkedProducts?: number;
  latestImport?: {
    id: number;
    filename: string;
    rowCount: number;
    linkedCount: number;
    importedAt: string;
    status: string;
  };
}

interface ImportResult {
  success: boolean;
  stats: {
    totalRows: number;
    processed: number;
    linked: number;
    unlinked: number;
  };
  exchangeRate: number;
  supplierId: number;
  catalogId: number;
  errors?: string[];
}

interface LinkedProduct {
  linkId: number;
  supplierCode: string;
  supplierStockQty: number;
  stockLocked: boolean;
  productId: number;
  productName: string;
  productSku: string | null;
  hasSupplierStock: boolean;
  rawPrice: number | null;
  finalCostArs: number | null;
}

export default function SenteySupplierPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [info, setInfo] = useState<SenteyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [defaultStockQty, setDefaultStockQty] = useState(10);
  const [linkedProducts, setLinkedProducts] = useState<LinkedProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [togglingLock, setTogglingLock] = useState<number | null>(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers/sentey/import");
      const data = await res.json();
      setInfo(data);
      if (data.supplier?.stockConfig) {
        try {
          const cfg = JSON.parse(data.supplier.stockConfig);
          setDefaultStockQty(cfg.defaultStockQty ?? 10);
        } catch {}
      }
    } catch {
      toast.error("Error al cargar información de Sentey");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLinkedProducts = useCallback(async () => {
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/suppliers/sentey/stock");
      const data = await res.json();
      setLinkedProducts(data.items ?? []);
    } catch {
      toast.error("Error al cargar productos vinculados");
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
    fetchLinkedProducts();
  }, [fetchInfo, fetchLinkedProducts]);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace("/suppliers");
    }
  }, [session, status, router]);

  const handleSaveConfig = async () => {
    if (!info?.supplier) return;
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/suppliers/${info.supplier.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockConfig: JSON.stringify({ defaultStockQty }),
        }),
      });
      if (res.ok) {
        toast.success("Configuración de stock guardada");
        fetchInfo();
      } else {
        toast.error("Error al guardar configuración");
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];

    if (!file) {
      toast.error("Seleccione un archivo XLSX");
      return;
    }

    setImporting(true);
    setLastResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/suppliers/sentey/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Error en la importación");

      setLastResult(result);
      toast.success(`Importación completada: ${result.stats.linked} productos actualizados`);
      fetchInfo();
      fetchLinkedProducts();
      fileInput.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en la importación");
    } finally {
      setImporting(false);
    }
  };

  const handleToggleLock = async (linkId: number, currentlyLocked: boolean) => {
    setTogglingLock(linkId);
    try {
      const res = await fetch("/api/suppliers/sentey/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkId, locked: !currentlyLocked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al actualizar stock");

      toast.success(
        !currentlyLocked
          ? "Producto marcado como agotado"
          : "Stock del producto restaurado"
      );
      fetchLinkedProducts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error al actualizar stock");
    } finally {
      setTogglingLock(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded w-48" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  const lockedCount = linkedProducts.filter((p) => p.stockLocked).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/suppliers">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Sentey — Importar Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Formato XLSX · Columnas D–G · Precios USD sin IVA · Sin impuestos internos
          </p>
        </div>
        <Badge variant={info?.exists ? "success" : "secondary"}>
          {info?.exists ? "Activo" : "Sin importaciones"}
        </Badge>
        {info?.supplier && (
          <Link href={`/suppliers/${info.supplier.id}`}>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" /> Configuración
            </Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Importar lista de precios
            </CardTitle>
            <CardDescription>
              Subí la lista XLSX mensual de Sentey. Los productos agotados no se modifican
              si tienen el stock bloqueado manualmente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <Label htmlFor="file">Archivo XLSX</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={importing}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Col D: Código · Col E: Descripción · Col F: Precio s/IVA · Col G: Tasa IVA
                </p>
              </div>
              <Button type="submit" disabled={importing} className="w-full">
                {importing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Importando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" /> Importar
                  </>
                )}
              </Button>
            </form>

            {lastResult && (
              <div className="mt-4 p-4 bg-muted rounded-lg space-y-3">
                <div className="flex items-center gap-2 text-green-600 font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Importación completada
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-muted-foreground">Productos en lista</span>
                  <span className="font-medium">{lastResult.stats.totalRows.toLocaleString()}</span>
                  <span className="text-muted-foreground">Precios actualizados</span>
                  <span className="font-medium text-green-600">{lastResult.stats.linked}</span>
                  <span className="text-muted-foreground">Sin vincular</span>
                  <span className="font-medium text-orange-600">{lastResult.stats.unlinked}</span>
                  <span className="text-muted-foreground">Dólar usado</span>
                  <span className="font-medium">$ {lastResult.exchangeRate.toLocaleString("es-AR")}</span>
                </div>
                {lastResult.stats.unlinked > 0 && (
                  <div className="flex gap-2 pt-1">
                    <Link href={`/suppliers/${lastResult.supplierId}/catalog/match`}>
                      <Button size="sm" variant="outline">
                        <Link2 className="h-3 w-3 mr-1" />
                        Vincular sin match
                      </Button>
                    </Link>
                    <Link href={`/suppliers/${lastResult.supplierId}/catalog`}>
                      <Button size="sm" variant="ghost">
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Ver catálogo
                      </Button>
                    </Link>
                  </div>
                )}
                {lastResult.errors && lastResult.errors.length > 0 && (
                  <div className="text-xs text-red-600 space-y-0.5">
                    <p className="font-medium">Errores ({lastResult.errors.length}):</p>
                    {lastResult.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Estado
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {info?.exists && info.supplier ? (
              <>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Código</p>
                    <p className="font-mono font-medium">{info.supplier.code}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Moneda</p>
                    <p>{info.supplier.currency}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">Productos vinculados</p>
                    <p className="text-2xl font-bold text-green-600">{info.linkedProducts}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs mb-0.5">IIBB</p>
                    <p>{(info.supplier.taxRate * 100).toFixed(1)}%</p>
                  </div>
                </div>

                {info.latestImport && (
                  <>
                    <Separator />
                    <div className="text-sm space-y-1">
                      <p className="text-muted-foreground text-xs">Última importación</p>
                      <p className="font-medium truncate">{info.latestImport.filename}</p>
                      <p className="text-muted-foreground">
                        {new Date(info.latestImport.importedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                      </p>
                      <div className="flex gap-4 text-sm pt-1">
                        <span>Total: {info.latestImport.rowCount.toLocaleString()}</span>
                        <span className="text-green-600">Vinc: {info.latestImport.linkedCount}</span>
                        <span className="text-orange-600">
                          Sin vinc: {info.latestImport.rowCount - info.latestImport.linkedCount}
                        </span>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Link href={`/suppliers/${info.supplier.id}/catalog/match`}>
                          <Button variant="outline" size="sm">
                            <Link2 className="h-3 w-3 mr-1" /> Vincular
                          </Button>
                        </Link>
                        <Link href={`/suppliers/${info.supplier.id}/catalog`}>
                          <Button variant="ghost" size="sm">
                            Ver catálogo
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">
                  El proveedor se crea automáticamente en la primera importación.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Stock config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuración de Stock
          </CardTitle>
          <CardDescription>
            Sentey no incluye estado de stock en la lista. Todos los productos presentes se
            consideran en stock con la cantidad configurada aquí.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-6 flex-wrap">
            <div className="space-y-1.5">
              <Label htmlFor="default-qty">Cantidad por defecto</Label>
              <Input
                id="default-qty"
                type="number"
                min={0}
                value={defaultStockQty}
                onChange={(e) => setDefaultStockQty(parseInt(e.target.value) || 0)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">Asignado a cada producto al importar</p>
            </div>
            <Button
              onClick={handleSaveConfig}
              disabled={savingConfig || !info?.exists}
              variant="outline"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingConfig ? "Guardando..." : "Guardar"}
            </Button>
          </div>
          {!info?.exists && (
            <p className="text-xs text-muted-foreground mt-3">
              Disponible después de la primera importación.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Linked products — stock management */}
      {linkedProducts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Gestión de Stock Manual
            </CardTitle>
            <CardDescription>
              Cuando Sentey te avisa que un producto se agotó (sin actualizar la lista), marcálo
              como agotado aquí. El bloqueo persiste aunque importes una lista nueva — desbloqueálo
              manualmente cuando vuelva a estar disponible.
              {lockedCount > 0 && (
                <span className="ml-2 text-orange-600 font-medium">
                  {lockedCount} producto{lockedCount !== 1 ? "s" : ""} agotado
                  {lockedCount !== 1 ? "s" : ""}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingProducts ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-10 bg-muted animate-pulse rounded" />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4 font-medium">Producto</th>
                      <th className="text-left py-2 pr-4 font-medium">SKU / Código</th>
                      <th className="text-right py-2 pr-4 font-medium">USD s/IVA</th>
                      <th className="text-center py-2 pr-4 font-medium">Stock</th>
                      <th className="text-center py-2 font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {linkedProducts.map((product) => (
                      <tr
                        key={product.linkId}
                        className={product.stockLocked ? "bg-orange-50 dark:bg-orange-950/20" : ""}
                      >
                        <td className="py-2 pr-4">
                          <span className="font-medium line-clamp-1">{product.productName}</span>
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                          {product.productSku || product.supplierCode}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {product.rawPrice != null
                            ? `$${product.rawPrice.toLocaleString("es-AR", { minimumFractionDigits: 2 })}`
                            : "—"}
                        </td>
                        <td className="py-2 pr-4 text-center">
                          {product.stockLocked ? (
                            <Badge variant="destructive" className="text-xs">Agotado</Badge>
                          ) : (
                            <Badge variant="success" className="text-xs">
                              {product.supplierStockQty}u
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 text-center">
                          <Button
                            size="sm"
                            variant={product.stockLocked ? "outline" : "ghost"}
                            disabled={togglingLock === product.linkId}
                            onClick={() => handleToggleLock(product.linkId, product.stockLocked)}
                            className={
                              product.stockLocked
                                ? "text-green-600 hover:text-green-700 border-green-200 hover:border-green-300"
                                : "text-orange-600 hover:text-orange-700"
                            }
                          >
                            {togglingLock === product.linkId ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : product.stockLocked ? (
                              <>
                                <Unlock className="h-3 w-3 mr-1" /> Reponer
                              </>
                            ) : (
                              <>
                                <Lock className="h-3 w-3 mr-1" /> Agotar
                              </>
                            )}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
