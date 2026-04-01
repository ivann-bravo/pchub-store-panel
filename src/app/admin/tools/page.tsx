"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle, Eye, Wrench, ChevronDown, ChevronRight } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface SlotAnalysis {
  slotId: number;
  comboId: number;
  comboName: string;
  slotName: string;
  filterCategory: string;
  currentKeywords: string[];
  currentAttributes: Record<string, string>;
  proposedKeywords: string[];
  proposedAttributes: Record<string, string>;
  inferredSocket: string | null;
  inferredMemoryType: string | null;
  warnings: string[];
  hasChanges: boolean;
}

interface ReviewResult {
  summary: { totalSlots: number; slotsWithChanges: number; slotsWithWarnings: number };
  slots: SlotAnalysis[];
}

interface ApplyResult {
  dryRun: boolean;
  slotsUpdated: number;
  productsUpdated: number;
  applied: { slotId: number; comboName: string; slotName: string; change: string }[];
}

// ── Component ──────────────────────────────────────────────────────────────────
export default function AdminToolsPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const isSuperAdmin = (session?.user as { role?: string })?.role === "SUPER_ADMIN";

  const [reviewData, setReviewData] = useState<ReviewResult | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSlots, setExpandedSlots] = useState<Set<number>>(new Set());
  const [showOnlyChanges, setShowOnlyChanges] = useState(true);

  useEffect(() => {
    if (session && !isSuperAdmin) router.push("/");
  }, [session, isSuperAdmin, router]);

  if (!session || !isSuperAdmin) return null;

  const doReview = async () => {
    setLoading("review");
    setError(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/admin/fix-mother-attributes");
      if (!res.ok) throw new Error(await res.text());
      setReviewData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(null);
    }
  };

  const doApply = async (dry: boolean) => {
    const label = dry ? "dry-run" : "apply";
    setLoading(label);
    setError(null);
    try {
      const res = await fetch(`/api/admin/fix-mother-attributes${dry ? "?dry=1" : ""}`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data: ApplyResult = await res.json();
      setApplyResult(data);
      if (!dry) setReviewData(null); // force re-review after apply
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(null);
    }
  };

  const toggleSlot = (id: number) =>
    setExpandedSlots((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });

  const displaySlots = reviewData?.slots.filter((s) => (showOnlyChanges ? s.hasChanges : true)) ?? [];

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Herramientas Admin</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Operaciones de mantenimiento masivo. Solo visible para SUPER_ADMIN.
        </p>
      </div>

      {/* ── Tool: Fix Mother Attributes ───────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Fix Atributos de Mothers en Combos
          </CardTitle>
          <CardDescription>
            Limpia tokens de socket (1200, 1700…) de los keywords de slots madre y setea
            los atributos <code>socket</code> y <code>memoryType</code> correctamente según
            el chipset (H510, B660, A520, etc.). Los chipsets quedan intactos en keywords.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* Buttons */}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={doReview} disabled={!!loading}>
              <Eye className="h-4 w-4 mr-2" />
              {loading === "review" ? "Revisando…" : "1. Revisar estado actual"}
            </Button>
            <Button variant="outline" onClick={() => doApply(true)} disabled={!!loading || !reviewData}>
              {loading === "dry-run" ? "Simulando…" : "2. Simular cambios (dry-run)"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm("¿Aplicar cambios en producción? Esta operación modifica la DB.")) doApply(false);
              }}
              disabled={!!loading}
            >
              {loading === "apply" ? "Aplicando…" : "3. Aplicar en producción"}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Apply result */}
          {applyResult && (
            <div className="bg-muted rounded-md p-4 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle className="h-4 w-4 text-green-600" />
                {applyResult.dryRun ? "Simulación completada" : "¡Aplicado con éxito!"}
              </div>
              <div className="text-sm text-muted-foreground">
                • Slots actualizados: <strong>{applyResult.slotsUpdated}</strong><br />
                • Productos actualizados: <strong>{applyResult.productsUpdated}</strong>
              </div>
              {applyResult.applied.length > 0 && (
                <div className="mt-2 max-h-64 overflow-y-auto text-xs font-mono space-y-1">
                  {applyResult.applied.map((a) => (
                    <div key={a.slotId} className="border-l-2 border-primary/30 pl-2">
                      <span className="font-semibold">{a.comboName}</span> / {a.slotName}
                      <br />
                      <span className="text-muted-foreground">{a.change}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Review result */}
          {reviewData && (
            <div className="space-y-3">
              {/* Summary badges */}
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="outline">Total slots madre: {reviewData.summary.totalSlots}</Badge>
                <Badge variant={reviewData.summary.slotsWithChanges > 0 ? "default" : "outline"}>
                  Con cambios: {reviewData.summary.slotsWithChanges}
                </Badge>
                <Badge variant={reviewData.summary.slotsWithWarnings > 0 ? "destructive" : "outline"}>
                  Con warnings: {reviewData.summary.slotsWithWarnings}
                </Badge>
                <button
                  className="text-xs text-muted-foreground underline ml-auto"
                  onClick={() => setShowOnlyChanges((v) => !v)}
                >
                  {showOnlyChanges ? "Mostrar todos" : "Solo con cambios"}
                </button>
              </div>

              {/* Slot list */}
              <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                {displaySlots.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    {showOnlyChanges ? "No hay slots con cambios pendientes." : "No hay slots de mothers."}
                  </p>
                )}
                {displaySlots.map((slot) => {
                  const expanded = expandedSlots.has(slot.slotId);
                  return (
                    <div key={slot.slotId} className="border rounded-md text-sm">
                      <button
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left"
                        onClick={() => toggleSlot(slot.slotId)}
                      >
                        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                        <span className="font-medium truncate flex-1">{slot.comboName}</span>
                        <span className="text-muted-foreground shrink-0">/ {slot.slotName}</span>
                        {slot.warnings.length > 0 && (
                          <AlertCircle className="h-3 w-3 text-amber-500 shrink-0" />
                        )}
                        {slot.hasChanges && (
                          <Badge variant="outline" className="text-xs shrink-0">cambios</Badge>
                        )}
                      </button>

                      {expanded && (
                        <div className="px-4 pb-3 space-y-2 border-t bg-muted/20">
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">KEYWORDS ACTUALES</p>
                              <div className="flex flex-wrap gap-1">
                                {slot.currentKeywords.map((k) => (
                                  <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                                ))}
                                {slot.currentKeywords.length === 0 && <span className="text-xs italic text-muted-foreground">ninguna</span>}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">KEYWORDS PROPUESTAS</p>
                              <div className="flex flex-wrap gap-1">
                                {slot.proposedKeywords.map((k) => (
                                  <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
                                ))}
                                {slot.proposedKeywords.length === 0 && <span className="text-xs italic text-muted-foreground">ninguna</span>}
                              </div>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">ATRIBUTOS ACTUALES</p>
                              <code className="text-xs">{JSON.stringify(slot.currentAttributes)}</code>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">ATRIBUTOS PROPUESTOS</p>
                              <code className="text-xs">{JSON.stringify(slot.proposedAttributes)}</code>
                            </div>
                          </div>
                          {slot.warnings.length > 0 && (
                            <div className="space-y-1">
                              {slot.warnings.map((w, i) => (
                                <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                                  <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                  {w}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
