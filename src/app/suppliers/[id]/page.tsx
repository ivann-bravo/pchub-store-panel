"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ArrowLeft, Save, Upload, List, Wifi, RefreshCw, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import type { Supplier } from "@/types";
import { getImportPage } from "@/lib/connectors/file-connectors";

export default function SupplierDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace(`/suppliers/${params.id}/catalog`);
    }
  }, [session, status, router, params.id]);

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [taxRate, setTaxRate] = useState(0);
  const [shippingSurcharge, setShippingSurcharge] = useState(0);
  const [shippingPercent, setShippingPercent] = useState(0);

  // API config state
  const [connectorType, setConnectorType] = useState<"manual" | "api">("manual");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiUsername, setApiUsername] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [apiClientId, setApiClientId] = useState<number | "">("");
  const [connectorId, setConnectorId] = useState("gn");
  const [autoSync, setAutoSync] = useState(false);
  const [notes, setNotes] = useState("");
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetch(`/api/suppliers/${params.id}`)
      .then((r) => r.json())
      .then((data) => {
        setSupplier(data);
        setName(data.name || "");
        setCode(data.code || "");
        setCurrency(data.currency);
        setTaxRate(data.taxRate);
        setShippingSurcharge(data.shippingSurcharge);
        setShippingPercent(data.shippingPercent);
        setConnectorType(data.connectorType || "manual");
        setAutoSync(data.autoSync ?? false);
        setNotes(data.notes || "");
        if (data.apiConfig) {
          try {
            const cfg = JSON.parse(data.apiConfig);
            setApiBaseUrl(cfg.baseUrl || "");
            setApiUsername(cfg.username || "");
            setApiPassword(cfg.password || "");
            setConnectorId(cfg.connectorId || "gn");
            setApiClientId(cfg.id ?? "");
          } catch {}
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  const handleSave = async () => {
    setSaving(true);
    const apiConfig = connectorType === "api"
      ? JSON.stringify({ baseUrl: apiBaseUrl, username: apiUsername, password: apiPassword, connectorId, ...(apiClientId !== "" ? { id: apiClientId } : {}) })
      : null;
    try {
      const res = await fetch(`/api/suppliers/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, code, currency, taxRate, shippingSurcharge, shippingPercent, connectorType, apiConfig, autoSync, notes: notes || null }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSupplier(updated);
        toast.success("Proveedor actualizado");
      } else {
        toast.error("Error al actualizar");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="h-64 bg-muted animate-pulse rounded" />;
  }

  if (!supplier) {
    return <div>Proveedor no encontrado</div>;
  }

  if (session?.user?.role === "VIEWER") return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <div className="flex-1 flex items-center gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xl font-bold h-10 max-w-[300px]"
            placeholder="Nombre del proveedor"
          />
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="font-mono h-10 w-[120px]"
            placeholder="Código"
          />
        </div>
        {getImportPage(supplier.code) ? (
          <Link href={getImportPage(supplier.code)!}>
            <Button variant="outline">
              <ExternalLink className="h-4 w-4 mr-1" /> Importar Catálogo
            </Button>
          </Link>
        ) : (
          <Link href={`/suppliers/${supplier.id}/import`}>
            <Button variant="outline">
              <Upload className="h-4 w-4 mr-1" /> Importar Catálogo
            </Button>
          </Link>
        )}
        <Link href={`/suppliers/${supplier.id}/catalog`}>
          <Button variant="outline">
            <List className="h-4 w-4 mr-1" /> Ver Catálogo
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Configuración de Pricing</CardTitle>
          <Button onClick={handleSave} disabled={saving} size="sm">
            <Save className="h-4 w-4 mr-1" /> {saving ? "Guardando..." : "Guardar"}
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Label>Moneda</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ARS">ARS (Pesos)</SelectItem>
                <SelectItem value="USD">USD (Dólares)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Tasa Impositiva (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={taxRate * 100}
              onChange={(e) => setTaxRate((parseFloat(e.target.value) || 0) / 100)}
            />
          </div>
          <div>
            <Label>Recargo Envío ($)</Label>
            <Input
              type="number"
              step="0.01"
              value={shippingSurcharge}
              onChange={(e) => setShippingSurcharge(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label>Recargo Envío (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={shippingPercent * 100}
              onChange={(e) => setShippingPercent((parseFloat(e.target.value) || 0) / 100)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Connector Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Tipo de Conexión</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Método de Importación</Label>
            <Select
              value={connectorType}
              onValueChange={(v) => setConnectorType(v as "manual" | "api")}
            >
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (CSV/Excel)</SelectItem>
                <SelectItem value="api">API Automática</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {connectorType === "api" && (
            <>
              <Separator />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Conector</Label>
                  <Select value={connectorId} onValueChange={setConnectorId}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gn">Grupo Nucleo (GN)</SelectItem>
                      <SelectItem value="nb">New Bytes (NB)</SelectItem>
                      <SelectItem value="elit">Elit</SelectItem>
                      <SelectItem value="polytech">Polytech</SelectItem>
                      <SelectItem value="pcarts">PC Arts</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Base URL</Label>
                  <Input
                    value={apiBaseUrl}
                    onChange={(e) => setApiBaseUrl(e.target.value)}
                    placeholder={
                      connectorId === "nb"
                        ? "https://api.nb.com.ar/v1"
                        : connectorId === "elit"
                        ? "https://clientes.elit.com.ar/v1/api"
                        : connectorId === "polytech"
                        ? "https://www.gestionresellers.com.ar/api/extranet/item"
                        : connectorId === "pcarts"
                        ? "https://api.pcarts.com/operations"
                        : "https://api.gruponucleosa.com"
                    }
                  />
                </div>
                {connectorId === "gn" && (
                  <div>
                    <Label>ID Cliente</Label>
                    <Input
                      type="number"
                      value={apiClientId}
                      onChange={(e) => setApiClientId(e.target.value ? parseInt(e.target.value) : "")}
                      placeholder="1074"
                    />
                  </div>
                )}
                {connectorId === "elit" && (
                  <div>
                    <Label>User ID</Label>
                    <Input
                      type="number"
                      value={apiClientId}
                      onChange={(e) => setApiClientId(e.target.value ? parseInt(e.target.value) : "")}
                      placeholder="24112"
                    />
                  </div>
                )}
                {connectorId !== "elit" && connectorId !== "polytech" && connectorId !== "pcarts" && (
                  <div>
                    <Label>Usuario</Label>
                    <Input
                      value={apiUsername}
                      onChange={(e) => setApiUsername(e.target.value)}
                      placeholder="usuario"
                    />
                  </div>
                )}
                {connectorId === "polytech" ? (
                  <div>
                    <Label>Token de API</Label>
                    <Input
                      type="password"
                      value={apiUsername}
                      onChange={(e) => setApiUsername(e.target.value)}
                      placeholder="••••••••"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Se usa como usuario en Basic Auth (password vacío).
                    </p>
                  </div>
                ) : (
                  <div>
                    <Label>{connectorId === "elit" || connectorId === "pcarts" ? "Token de API" : "Contraseña"}</Label>
                    <Input
                      type="password"
                      value={apiPassword}
                      onChange={(e) => setApiPassword(e.target.value)}
                      placeholder="••••••••"
                    />
                    {connectorId === "pcarts" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Header: x-session-token
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/50">
                <Switch
                  id="auto-sync"
                  checked={autoSync}
                  onCheckedChange={setAutoSync}
                />
                <Label htmlFor="auto-sync" className="cursor-pointer">
                  Auto-sync cada 30 min
                </Label>
                {autoSync && (
                  <span className="text-xs text-green-600 font-medium ml-auto">Activo</span>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    setTesting(true);
                    try {
                      await handleSave();
                      const res = await fetch(`/api/suppliers/${params.id}/sync`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "test" }),
                      });
                      const data = await res.json();
                      if (data.success) toast.success("Conexión exitosa");
                      else toast.error(data.error || "Conexión fallida");
                    } catch {
                      toast.error("Error al probar conexión");
                    } finally {
                      setTesting(false);
                    }
                  }}
                  disabled={testing || (connectorId === "elit" ? (!apiClientId || !apiPassword) : connectorId === "polytech" ? !apiUsername : connectorId === "pcarts" ? !apiPassword : (!apiUsername || !apiPassword))}
                >
                  {testing ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-1" />
                  )}
                  Test Conexión
                </Button>
                <Button
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      await handleSave();
                      const res = await fetch(`/api/suppliers/${params.id}/sync`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "sync" }),
                      });
                      const data = await res.json();
                      if (data.status === "completed") {
                        toast.success(
                          `Sincronizado: ${data.totalItems} items, ${data.linkedCount} vinculados`
                        );
                      } else {
                        toast.error(data.error || "Sincronización fallida");
                      }
                    } catch {
                      toast.error("Error al sincronizar");
                    } finally {
                      setSyncing(false);
                    }
                  }}
                  disabled={syncing || (connectorId === "elit" ? (!apiClientId || !apiPassword) : connectorId === "polytech" ? !apiUsername : connectorId === "pcarts" ? !apiPassword : (!apiUsername || !apiPassword))}
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Sincronizar Ahora
                </Button>
              </div>
            </>
          )}

          <Separator />
          <div>
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instrucciones sobre el proveedor, contacto, etc."
              rows={3}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
