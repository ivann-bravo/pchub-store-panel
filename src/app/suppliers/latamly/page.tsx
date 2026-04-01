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
  Layers,
} from "lucide-react";
import { toast } from "sonner";

interface LatamlyInfo {
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

const SHEETS = ["Redragon", "T-DAGGER", "XP-Pen", "Bmax", "Maono", "PXN", "Aiper"];

export default function LatamlySupplierPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [info, setInfo] = useState<LatamlyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [enStockQty, setEnStockQty] = useState(10);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers/latamly/import");
      const data = await res.json();
      setInfo(data);
      if (data.supplier?.stockConfig) {
        try {
          const cfg = JSON.parse(data.supplier.stockConfig);
          setEnStockQty(cfg.enStockQty ?? 10);
        } catch {}
      }
    } catch {
      toast.error("Error al cargar información de Latamly");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

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
          stockConfig: JSON.stringify({ enStockQty }),
        }),
      });
      if (res.ok) {
        toast.success("Configuración guardada");
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

      const res = await fetch("/api/suppliers/latamly/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Error en la importación");

      setLastResult(result);
      toast.success(`Importación completada: ${result.stats.linked} productos actualizados`);
      fetchInfo();
      fileInput.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en la importación");
    } finally {
      setImporting(false);
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
          <h1 className="text-2xl font-bold">Latamly — Importar Catálogo</h1>
          <p className="text-sm text-muted-foreground">
            Formato XLSX multi-hoja · SKU col C · Precio USD col G · Stock col J · Sin impuestos internos
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
              Subí el XLSX de Latamly. Se procesan todas las hojas automáticamente.
              El stock se toma directamente de la columna J.
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
                  Hojas esperadas: {SHEETS.join(" · ")}
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

      {/* Hojas / marcas */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Marcas incluidas
          </CardTitle>
          <CardDescription>
            El archivo tiene una hoja por marca. Todas se importan en un solo paso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {SHEETS.map((s) => (
              <Badge key={s} variant="outline" className="font-medium">
                {s}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Stock config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuración de Stock
          </CardTitle>
          <CardDescription>
            La columna J del Excel contiene la cantidad real de stock. Cuando el valor es
            &quot;EN STOCK&quot; (sin número), se usa la cantidad configurada aquí.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-6 flex-wrap">
            <div className="space-y-1.5">
              <Label htmlFor="en-stock-qty">Cantidad para &quot;EN STOCK&quot;</Label>
              <Input
                id="en-stock-qty"
                type="number"
                min={0}
                value={enStockQty}
                onChange={(e) => setEnStockQty(parseInt(e.target.value) || 0)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Cuando la columna J dice &quot;EN STOCK&quot; sin número
              </p>
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
          <p className="text-xs text-muted-foreground mt-4">
            <span className="font-medium">SIN STOCK</span> → stock 0, sin disponibilidad. &nbsp;
            <span className="font-medium">Número</span> → cantidad exacta del proveedor.
          </p>
          {!info?.exists && (
            <p className="text-xs text-muted-foreground mt-2">
              Disponible después de la primera importación.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
