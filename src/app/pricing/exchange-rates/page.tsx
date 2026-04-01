"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { RefreshCw, X } from "lucide-react";
import { formatARS } from "@/lib/number-format";
import { toast } from "sonner";

interface ExchangeRateData {
  id: number;
  source: string;
  buyRate: number;
  sellRate: number;
  fetchedAt: string;
  isOverride: boolean;
}

export default function ExchangeRatesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role === "VIEWER") {
      router.replace("/pricing/alerts");
    }
  }, [session, status, router]);

  const [rate, setRate] = useState<ExchangeRateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [overrideInput, setOverrideInput] = useState("");
  const [settingOverride, setSettingOverride] = useState(false);

  const fetchRate = async () => {
    try {
      const res = await fetch("/api/exchange-rate");
      const data = await res.json();
      if (!data.error) {
        setRate(data);
        if (data.isOverride) {
          setOverrideInput(data.sellRate.toString());
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRate();
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/exchange-rate", { method: "POST" });
      const data = await res.json();
      if (!data.error) {
        setRate(data);
        setOverrideInput("");
        toast.success("Cotización actualizada desde API");
      } else {
        toast.error("Error al obtener cotización");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setRefreshing(false);
    }
  };

  const setOverride = async () => {
    const value = parseFloat(overrideInput);
    if (isNaN(value) || value <= 0) {
      toast.error("Ingrese un valor válido");
      return;
    }
    setSettingOverride(true);
    try {
      const res = await fetch("/api/exchange-rate", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: value }),
      });
      const data = await res.json();
      if (!data.error) {
        setRate(data);
        toast.success("Dólar manual configurado");
      } else {
        toast.error(data.error);
      }
    } catch {
      toast.error("Error al configurar override");
    } finally {
      setSettingOverride(false);
    }
  };

  const clearOverride = async () => {
    try {
      await fetch("/api/exchange-rate", { method: "DELETE" });
      setOverrideInput("");
      toast.success("Override eliminado");
      await fetchRate();
    } catch {
      toast.error("Error al limpiar override");
    }
  };

  if (status === "loading" || session?.user?.role === "VIEWER") return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotización del Dólar"
        breadcrumbs={[{ label: "Precios", href: "/pricing" }, { label: "Cotización USD" }]}
        description="Configurá la cotización usada para calcular precios en ARS"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl">
        {/* Current Rate Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Dólar Actual</CardTitle>
            {rate?.isOverride && (
              <span className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded">
                Manual
              </span>
            )}
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-20 bg-muted animate-pulse rounded" />
            ) : rate ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground">Compra</p>
                    <p className="text-3xl font-bold">{formatARS(rate.buyRate)}</p>
                  </div>
                  <div className="bg-green-50 dark:bg-green-950/20 p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground">Venta</p>
                    <p className="text-3xl font-bold text-green-600">{formatARS(rate.sellRate)}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Fuente: {rate.isOverride ? "Manual" : "dolarapi.com"} · {new Date(rate.fetchedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })}
                </p>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-muted-foreground mb-4">No hay cotización cargada</p>
                <Button onClick={refresh}>Obtener Cotización</Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Override Card */}
        <Card>
          <CardHeader>
            <CardTitle>Override Manual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="override">Dólar Venta Manual</Label>
              <div className="flex gap-2">
                <Input
                  id="override"
                  type="number"
                  step="0.01"
                  placeholder="Ej: 1050.50"
                  value={overrideInput}
                  onChange={(e) => setOverrideInput(e.target.value)}
                />
                <Button onClick={setOverride} disabled={settingOverride || !overrideInput}>
                  {settingOverride ? "..." : "Aplicar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Usar este valor en lugar de la API para todos los cálculos.
              </p>
            </div>

            {rate?.isOverride && (
              <Button variant="outline" size="sm" onClick={clearOverride} className="w-full">
                <X className="h-4 w-4 mr-1" /> Limpiar Override (volver a API)
              </Button>
            )}

            <div className="border-t pt-4">
              <Button onClick={refresh} disabled={refreshing} variant="outline" className="w-full">
                <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Actualizando..." : "Actualizar desde API"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
