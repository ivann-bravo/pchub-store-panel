"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, RefreshCw, CheckCircle, AlertCircle, Package, Link2 } from "lucide-react";
import { toast } from "sonner";
import { formatARS } from "@/lib/number-format";

interface AirInfo {
  exists: boolean;
  supplier?: {
    id: number;
    code: string;
    name: string;
    currency: string;
    taxRate: number;
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
  catalogId: number;
  supplierId: number;
  stats: {
    totalRows: number;
    processed: number;
    skipped: number;
    linked: number;
    unlinked: number;
  };
  exchangeRate: number;
  errors?: string[];
}

interface CatalogItem {
  id: number;
  supplierCode: string;
  description: string;
  price: number;
  stockAvailable: boolean;
  linkedProductId: number | null;
  rawData: string;
}

export default function AirSupplierPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [info, setInfo] = useState<AirInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [unlinkedItems, setUnlinkedItems] = useState<CatalogItem[]>([]);
  const [showUnlinked, setShowUnlinked] = useState(false);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers/air/import");
      const data = await res.json();
      setInfo(data);
    } catch {
      toast.error("Error al cargar información de AIR");
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

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];

    if (!file) {
      toast.error("Seleccione un archivo CSV");
      return;
    }

    setImporting(true);
    setLastResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/suppliers/air/import", {
        method: "POST",
        body: formData,
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Error en la importación");
      }

      setLastResult(result);
      toast.success(`Importación completada: ${result.stats.linked} productos vinculados`);

      // Refresh info
      fetchInfo();

      // Clear file input
      fileInput.value = "";
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Error en la importación");
    } finally {
      setImporting(false);
    }
  };

  const fetchUnlinkedItems = async () => {
    if (!info?.latestImport) return;

    try {
      const res = await fetch(`/api/suppliers/${info.supplier?.id}/catalog?catalogId=${info.latestImport.id}&unlinkedOnly=true`);
      const data = await res.json();
      setUnlinkedItems(data.items || []);
      setShowUnlinked(true);
    } catch {
      toast.error("Error al cargar items sin vincular");
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AIR Computers</h1>
          <p className="text-muted-foreground">Integración con proveedor AIR</p>
        </div>
        <Badge variant={info?.exists ? "default" : "secondary"}>
          {info?.exists ? "Configurado" : "Pendiente"}
        </Badge>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Import Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Importar Catálogo
            </CardTitle>
            <CardDescription>
              Suba el archivo CSV de AIR para actualizar precios y stock
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <Label htmlFor="file">Archivo CSV</Label>
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".csv"
                  disabled={importing}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Formato esperado: Codigo, Descripcion, Precio USD, Tipo, IVA, ROS, MZA, CBA, LUG, Grupo, Rubro, Part Number
                </p>
              </div>
              <Button type="submit" disabled={importing} className="w-full">
                {importing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Importando...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Importar Catálogo
                  </>
                )}
              </Button>
            </form>

            {/* Import Result */}
            {lastResult && (
              <div className="mt-4 p-4 bg-muted rounded-lg space-y-2">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span className="font-medium">Importación completada</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>Total filas: <span className="font-medium">{lastResult.stats.totalRows}</span></div>
                  <div>Procesados: <span className="font-medium">{lastResult.stats.processed}</span></div>
                  <div>Vinculados: <span className="font-medium text-green-600">{lastResult.stats.linked}</span></div>
                  <div>Sin vincular: <span className="font-medium text-orange-600">{lastResult.stats.unlinked}</span></div>
                  <div>Omitidos: <span className="font-medium text-muted-foreground">{lastResult.stats.skipped}</span></div>
                  <div>Dólar: <span className="font-medium">{formatARS(lastResult.exchangeRate)}</span></div>
                </div>
                {lastResult.errors && lastResult.errors.length > 0 && (
                  <div className="mt-2 text-xs text-red-600">
                    <p className="font-medium">Errores:</p>
                    {lastResult.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Estado del Proveedor
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {info?.exists && info.supplier ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground text-xs">Código</Label>
                    <p className="font-mono">{info.supplier.code}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Moneda</Label>
                    <p>{info.supplier.currency}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">Productos Vinculados</Label>
                    <p className="text-2xl font-bold text-green-600">{info.linkedProducts}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground text-xs">IIBB</Label>
                    <p>{(info.supplier.taxRate * 100).toFixed(1)}%</p>
                  </div>
                </div>

                {info.latestImport && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-muted-foreground text-xs">Última Importación</Label>
                      <p className="font-medium">{info.latestImport.filename}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(info.latestImport.importedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                      </p>
                      <div className="flex gap-4 mt-2 text-sm">
                        <span>Total: {info.latestImport.rowCount}</span>
                        <span className="text-green-600">Vinculados: {info.latestImport.linkedCount}</span>
                        <span className="text-orange-600">
                          Sin vincular: {info.latestImport.rowCount - info.latestImport.linkedCount}
                        </span>
                      </div>
                      {info.latestImport.rowCount - info.latestImport.linkedCount > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={fetchUnlinkedItems}
                        >
                          <Link2 className="h-4 w-4 mr-1" />
                          Ver productos sin vincular
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>El proveedor se creará automáticamente al importar el primer catálogo</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Notes Card */}
      <Card>
        <CardHeader>
          <CardTitle>Notas de Integración</CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none">
          <ul>
            <li><strong>Stock:</strong> Solo se considera stock disponible el de LUG (Luján). ROS, MZA y CBA se guardan como referencia.</li>
            <li><strong>IVA:</strong> Se toma del CSV (10.5% o 21%).</li>
            <li><strong>Impuestos internos:</strong> Se detectan automáticamente para monitores de marcas Asus, Dell, Gigabyte, Hikvision, LG y MSI (10.5%).</li>
            <li><strong>Vinculación:</strong> Los productos se vinculan por el código interno de AIR. Para vincular nuevos productos, use la página de vinculación.</li>
          </ul>
        </CardContent>
      </Card>

      {/* Unlinked Items Modal/Section */}
      {showUnlinked && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Productos de AIR sin vincular</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowUnlinked(false)}>
              Cerrar
            </Button>
          </CardHeader>
          <CardContent>
            {unlinkedItems.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                No se encontraron items sin vincular
              </p>
            ) : (
              <div className="max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Código</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="text-right">Precio USD</TableHead>
                      <TableHead>Stock LUG</TableHead>
                      <TableHead>SKU</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unlinkedItems.slice(0, 50).map((item) => {
                      const extra = item.rawData ? JSON.parse(item.rawData) : {};
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.supplierCode}</TableCell>
                          <TableCell className="max-w-xs truncate">{item.description}</TableCell>
                          <TableCell className="text-right">${item.price?.toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={extra.stock?.lug > 0 ? "default" : "secondary"}>
                              {extra.stock?.lug ?? 0}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{extra.sku || "-"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {unlinkedItems.length > 50 && (
                  <p className="text-sm text-muted-foreground mt-2 text-center">
                    Mostrando 50 de {unlinkedItems.length} items
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
