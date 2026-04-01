"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const FIELDS = [
  { key: "company_razon_social",     label: "Razón Social",          placeholder: "PCHub Argentina S.R.L." },
  { key: "company_cuit",             label: "CUIT",                  placeholder: "30-12345678-9" },
  { key: "company_domicilio",        label: "Domicilio",             placeholder: "Av. Corrientes 1234, CABA" },
  { key: "company_iva_condition",    label: "Condición IVA",         placeholder: "Responsable Inscripto" },
  { key: "company_ingresos_brutos",  label: "Ingresos Brutos",       placeholder: "30-12345678-9" },
  { key: "company_inicio_actividades", label: "Inicio de Actividades", placeholder: "01/01/2020" },
  { key: "company_logo_url",         label: "URL del Logo (PDF)",    placeholder: "https://..." },
];

export default function EmpresaSettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json() as { key: string; value: string }[];
        const map: Record<string, string> = {};
        for (const row of data) map[row.key] = String(row.value);
        const initial: Record<string, string> = {};
        for (const f of FIELDS) initial[f.key] = map[f.key] ?? "";
        setValues(initial);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const f of FIELDS) {
        await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: f.key, value: values[f.key] ?? "" }),
        });
      }
      toast.success("Datos de empresa guardados");
    } catch {
      toast.error("Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Datos de Empresa</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Estos datos aparecen en el encabezado de los presupuestos en PDF.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Información legal</CardTitle>
          <CardDescription>Aparece en el bloque legal del PDF (razón social, CUIT, etc.)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Cargando...</p>
          ) : (
            <>
              {FIELDS.map((f) => (
                <div key={f.key}>
                  <Label>{f.label}</Label>
                  <Input
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
              <Button onClick={handleSave} disabled={saving} className="w-full">
                {saving ? "Guardando..." : "Guardar datos de empresa"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
