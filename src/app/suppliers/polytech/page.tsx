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
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Package,
  Link2,
  Settings,
  Search,
  Wifi,
  PlusCircle,
  ExternalLink,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface PolytechInfo {
  exists: boolean;
  supplier?: {
    id: number;
    name: string;
    currency: string;
    taxRate: number;
  };
  linkedProducts?: number;
  latestSync?: {
    importedAt: string;
    rowCount: number;
    linkedCount: number;
    status: string;
  } | null;
}

interface SearchItem {
  sourceId: string;
  description: string;
  priceWithIva: number;
  precioSinIva: number;
  ivaRate: number;
  stock: number;
  stockAvailable: boolean;
  linkedProductId: number | null;
  rawData: Record<string, unknown>;
}

interface SearchResult {
  items: SearchItem[];
  total: number;
  pages: number;
  page: number;
}

interface SyncResult {
  success: boolean;
  linked: number;
  total: number;
  errors?: string[];
  message?: string;
}

interface ImportResult {
  success: boolean;
  source: "auto" | "upload";
  total: number;
  linked: number;
  unlinked: number;
  exchangeRate: number;
  parseErrors?: string[];
  autoDownloadFailed?: boolean;
  error?: string;
}

export default function PolytechSupplierPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [info, setInfo] = useState<PolytechInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Setup form (first-time)
  const [setupToken, setSetupToken] = useState("");
  const [setupName, setSetupName] = useState("Polytech");
  const [setupIibb, setSetupIibb] = useState(0);
  const [settingUp, setSettingUp] = useState(false);
  const [testing, setTesting] = useState(false);

  // Search
  const [keyword, setKeyword] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [addingCode, setAddingCode] = useState<string | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  // Import
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/suppliers/polytech/sync");
      const data = await res.json();
      setInfo(data);
    } catch {
      toast.error("Error al cargar información de Polytech");
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

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch("/api/suppliers/polytech/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", token: setupToken }),
      });
      const data = await res.json();
      if (data.success) toast.success("Conexión exitosa ✓");
      else toast.error(data.error || "Conexión fallida");
    } catch {
      toast.error("Error al probar conexión");
    } finally {
      setTesting(false);
    }
  };

  const handleSetup = async () => {
    if (!setupToken.trim()) {
      toast.error("Ingresá el token de API");
      return;
    }
    setSettingUp(true);
    try {
      const res = await fetch("/api/suppliers/polytech/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setup",
          token: setupToken.trim(),
          name: setupName.trim() || "Polytech",
          taxRate: setupIibb / 100,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Proveedor Polytech configurado");
        await fetchInfo();
      } else {
        toast.error(data.error || "Error al configurar");
      }
    } finally {
      setSettingUp(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const res = await fetch("/api/suppliers/polytech/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", keyword: keyword.trim(), page: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en búsqueda");
      setSearchResult(data);
      if (data.items.length === 0) toast.info("Sin resultados para esa búsqueda");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en búsqueda");
    } finally {
      setSearching(false);
    }
  };

  const handleAddToCatalog = async (item: SearchItem) => {
    setAddingCode(item.sourceId);
    try {
      const res = await fetch("/api/suppliers/polytech/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add-to-catalog", item }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.alreadyExists) toast.info("Ya estaba en el catálogo");
        else toast.success(`${item.sourceId} agregado al catálogo`);
        // Mark in UI as "in catalog"
        setSearchResult((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((i) =>
                  i.sourceId === item.sourceId
                    ? { ...i, linkedProductId: -1 } // -1 = in catalog but not linked to a product
                    : i
                ),
              }
            : prev
        );
      } else {
        toast.error(data.error || "Error al agregar");
      }
    } catch {
      toast.error("Error al agregar al catálogo");
    } finally {
      setAddingCode(null);
    }
  };

  const handleAutoImport = async () => {
    setImporting(true);
    setLastImport(null);
    try {
      const res = await fetch("/api/suppliers/polytech/import");
      const data: ImportResult = await res.json();
      if (data.autoDownloadFailed || !data.success) {
        toast.error(data.error || "No se pudo descargar el Excel automáticamente");
      } else {
        toast.success(`Importación completa: ${data.total} productos`);
        setLastImport(data);
        await fetchInfo();
      }
      if (data.autoDownloadFailed) setLastImport(data);
    } catch {
      toast.error("Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const handleFileImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) { toast.error("Seleccioná un archivo Excel"); return; }

    setImporting(true);
    setLastImport(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/suppliers/polytech/import", {
        method: "POST",
        body: formData,
      });
      const data: ImportResult = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Error al importar");
      toast.success(`Importación completa: ${data.total} productos`);
      setLastImport(data);
      await fetchInfo();
      fileInput.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al importar");
    } finally {
      setImporting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setLastSync(null);
    try {
      const res = await fetch("/api/suppliers/polytech/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error en sincronización");
      setLastSync(data);
      toast.success(
        `Sync completado: ${data.linked} de ${data.total} productos actualizados`
      );
      await fetchInfo();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en sincronización");
    } finally {
      setSyncing(false);
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
          <h1 className="text-2xl font-bold">Polytech — API de Precios</h1>
          <p className="text-sm text-muted-foreground">
            gestionresellers.com.ar · Búsqueda por código · Precios USD con IVA
          </p>
        </div>
        <Badge variant={info?.exists ? "success" : "secondary"}>
          {info?.exists ? "Configurado" : "Sin configurar"}
        </Badge>
        {info?.supplier && (
          <Link href={`/suppliers/${info.supplier.id}`}>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" /> Configuración
            </Button>
          </Link>
        )}
      </div>

      {/* ── FIRST-TIME SETUP ────────────────────────────────────────────────── */}
      {!info?.exists && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5" />
              Primera configuración
            </CardTitle>
            <CardDescription>
              Ingresá el token de API de Polytech para comenzar. El proveedor se
              creará automáticamente.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>Nombre del proveedor</Label>
                <Input
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  placeholder="Polytech"
                />
              </div>
              <div>
                <Label>IIBB (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={setupIibb}
                  onChange={(e) => setSetupIibb(parseFloat(e.target.value) || 0)}
                  className="w-32"
                />
              </div>
            </div>
            <div>
              <Label>Token de API</Label>
              <Input
                type="password"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value)}
                placeholder="Tu token de acceso"
              />
              <p className="text-xs text-muted-foreground mt-1">
                El token se usa como usuario en autenticación HTTP Basic.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={testing || !setupToken.trim()}
              >
                {testing ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4 mr-1" />
                )}
                Probar conexión
              </Button>
              <Button
                onClick={handleSetup}
                disabled={settingUp || !setupToken.trim()}
              >
                {settingUp ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-1" />
                )}
                Guardar y activar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── CONFIGURED STATE ────────────────────────────────────────────────── */}
      {info?.exists && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Estado
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Nombre</p>
                  <p className="font-medium">{info.supplier?.name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">IIBB</p>
                  <p>{((info.supplier?.taxRate ?? 0) * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">
                    Productos vinculados
                  </p>
                  <p className="text-2xl font-bold text-green-600">
                    {info.linkedProducts}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Moneda</p>
                  <p>{info.supplier?.currency}</p>
                </div>
              </div>

              {info.latestSync && (
                <>
                  <Separator />
                  <div className="text-sm space-y-1">
                    <p className="text-muted-foreground text-xs">Último sync</p>
                    <p className="text-muted-foreground">
                      {new Date(info.latestSync.importedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                    </p>
                    <div className="flex gap-4 text-sm pt-1">
                      <span>Buscados: {info.latestSync.rowCount}</span>
                      <span className="text-green-600">
                        Actualizados: {info.latestSync.linkedCount}
                      </span>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Link href={`/suppliers/${info.supplier?.id}/catalog/match`}>
                        <Button variant="outline" size="sm">
                          <Link2 className="h-3 w-3 mr-1" /> Vincular
                        </Button>
                      </Link>
                      <Link href={`/suppliers/${info.supplier?.id}/catalog`}>
                        <Button variant="ghost" size="sm">
                          <ExternalLink className="h-3 w-3 mr-1" /> Ver catálogo
                        </Button>
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Sync card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5" />
                Sincronizar productos vinculados
              </CardTitle>
              <CardDescription>
                Actualiza precio y stock de los productos ya vinculados a Polytech.
                Se realiza una búsqueda por código a razón de 1 req/seg.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                onClick={handleSync}
                disabled={syncing || (info.linkedProducts ?? 0) === 0}
                className="w-full"
              >
                {syncing ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Sincronizando... (puede tardar)
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Sincronizar {info.linkedProducts} producto
                    {(info.linkedProducts ?? 0) !== 1 ? "s" : ""}
                  </>
                )}
              </Button>

              {(info.linkedProducts ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground text-center">
                  Buscá productos abajo y vincularlos al catálogo primero.
                </p>
              )}

              {lastSync && (
                <div className="p-3 bg-muted rounded-lg space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-green-600 font-medium">
                    <CheckCircle className="h-4 w-4" />
                    Sync completado
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <span className="text-muted-foreground">Procesados</span>
                    <span className="font-medium">{lastSync.total}</span>
                    <span className="text-muted-foreground">Actualizados</span>
                    <span className="font-medium text-green-600">
                      {lastSync.linked}
                    </span>
                  </div>
                  {lastSync.errors && lastSync.errors.length > 0 && (
                    <div className="text-xs text-red-600 space-y-0.5 pt-1">
                      <p className="font-medium">
                        Errores ({lastSync.errors.length}):
                      </p>
                      {lastSync.errors.slice(0, 5).map((e, i) => (
                        <p key={i}>{e}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── IMPORTAR CATÁLOGO COMPLETO ──────────────────────────────────────── */}
      {info?.exists && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Importar catálogo completo
            </CardTitle>
            <CardDescription>
              Trae todos los productos de Polytech (vinculados y sin vincular) para
              poder hacer el match completo. Intentá primero la descarga automática;
              si falla, descargá el Excel desde tu portal y subilo acá.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Descarga automática */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={handleAutoImport}
                disabled={importing}
                variant="default"
              >
                {importing ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Descargando e importando...</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" />Descargar e importar automáticamente</>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Usa el mismo token para bajar el Excel directamente desde Polytech
              </span>
            </div>

            <Separator />

            {/* Subida manual */}
            <form onSubmit={handleFileImport} className="space-y-2">
              <Label>O subir el Excel manualmente</Label>
              <p className="text-xs text-muted-foreground">
                Descargá desde:{" "}
                <code className="bg-muted px-1 rounded text-xs">
                  gestionresellers.com.ar/extranet/exportar/excel?lbv=
                </code>
              </p>
              <div className="flex gap-2">
                <input
                  name="file"
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={importing}
                  className="text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:bg-muted file:text-sm"
                />
                <Button type="submit" variant="outline" disabled={importing} size="sm">
                  <Upload className="h-4 w-4 mr-1" /> Importar
                </Button>
              </div>
            </form>

            {/* Resultado */}
            {lastImport && lastImport.success && (
              <div className="p-3 bg-muted rounded-lg space-y-2 text-sm">
                <div className="flex items-center gap-2 text-green-600 font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Importación completada
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Total productos</span>
                  <span className="font-medium">{lastImport.total.toLocaleString()}</span>
                  <span className="text-muted-foreground">Ya vinculados (precios actualizados)</span>
                  <span className="font-medium text-green-600">{lastImport.linked}</span>
                  <span className="text-muted-foreground">Sin vincular (disponibles para match)</span>
                  <span className="font-medium text-orange-600">{lastImport.unlinked}</span>
                  <span className="text-muted-foreground">Dólar usado</span>
                  <span className="font-medium">$ {lastImport.exchangeRate.toLocaleString("es-AR")}</span>
                </div>
                {lastImport.unlinked > 0 && info.supplier && (
                  <div className="pt-1">
                    <Link href={`/suppliers/${info.supplier.id}/catalog/match`}>
                      <Button size="sm" variant="outline">
                        <Link2 className="h-3 w-3 mr-1" />
                        Vincular los {lastImport.unlinked} sin match
                      </Button>
                    </Link>
                  </div>
                )}
                {lastImport.parseErrors && lastImport.parseErrors.length > 0 && (
                  <p className="text-xs text-orange-600">
                    Advertencias de parseo: {lastImport.parseErrors.join(" | ")}
                  </p>
                )}
              </div>
            )}

            {lastImport?.autoDownloadFailed && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-700">
                <AlertCircle className="h-4 w-4 inline mr-1" />
                {lastImport.error} — Usá la opción de subir el archivo manualmente.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── SEARCH ──────────────────────────────────────────────────────────── */}
      {info?.exists && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Buscar productos en Polytech
            </CardTitle>
            <CardDescription>
              Buscá por código o descripción. Hacé clic en{" "}
              <strong>Agregar al catálogo</strong> para que aparezca en la cola
              de vinculación.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Ej: ASUS TUF Gaming, RTX 4060..."
                className="flex-1"
              />
              <Button type="submit" disabled={searching || !keyword.trim()}>
                {searching ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                <span className="ml-1 hidden sm:inline">Buscar</span>
              </Button>
            </form>

            {searchResult && searchResult.items.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {searchResult.total} resultado{searchResult.total !== 1 ? "s" : ""}
                  {searchResult.pages > 1 &&
                    ` · Página ${searchResult.page} de ${searchResult.pages}`}
                </p>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left p-2 pl-3">Código</th>
                        <th className="text-left p-2">Descripción</th>
                        <th className="text-right p-2">Sin IVA (USD)</th>
                        <th className="text-right p-2">Con IVA (USD)</th>
                        <th className="text-right p-2">Stock</th>
                        <th className="p-2 w-28"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResult.items.map((item) => (
                        <tr
                          key={item.sourceId}
                          className="border-t hover:bg-muted/30"
                        >
                          <td className="p-2 pl-3 font-mono text-xs">
                            {item.sourceId}
                          </td>
                          <td className="p-2 max-w-[250px] truncate">
                            {item.description}
                          </td>
                          <td className="p-2 text-right font-medium">
                            ${item.precioSinIva.toFixed(2)}
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            ${item.priceWithIva.toFixed(2)}
                          </td>
                          <td className="p-2 text-right">
                            {item.stock > 0 ? (
                              <span className="text-green-600 font-medium">
                                {item.stock}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </td>
                          <td className="p-2 text-right">
                            {item.linkedProductId !== null ? (
                              <Badge variant="success" className="text-xs">
                                En catálogo
                              </Badge>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={addingCode === item.sourceId}
                                onClick={() => handleAddToCatalog(item)}
                              >
                                {addingCode === item.sourceId ? (
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                ) : (
                                  <PlusCircle className="h-3 w-3 mr-1" />
                                )}
                                Agregar
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {info.supplier && (
                  <div className="flex justify-end pt-1">
                    <Link href={`/suppliers/${info.supplier.id}/catalog/match`}>
                      <Button size="sm" variant="outline">
                        <Link2 className="h-3 w-3 mr-1" />
                        Ir a vincular catálogo
                      </Button>
                    </Link>
                  </div>
                )}
              </div>
            )}

            {searchResult && searchResult.items.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Sin resultados para &quot;{keyword}&quot;</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
