"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Clock, FileText, Phone, ChevronRight, Copy } from "lucide-react";
import { toast } from "sonner";
import type { QuoteSession, QuoteSessionStatus } from "@/types";

interface SessionWithCount extends QuoteSession {
  quoteCount: number;
}

const STATUS_LABELS: Record<QuoteSessionStatus, string> = {
  open: "Abierto",
  following_up: "En seguimiento",
  closed_wc: "Cerrado WC",
  closed_wpp: "Cerrado WhatsApp",
  closed_other: "Cerrado otro",
  lost: "Perdido",
};

const STATUS_VARIANTS: Record<QuoteSessionStatus, { bg: string; text: string }> = {
  open:          { bg: "bg-gray-100 dark:bg-gray-800",   text: "text-gray-600 dark:text-gray-400" },
  following_up:  { bg: "bg-amber-100 dark:bg-amber-900/40", text: "text-amber-700 dark:text-amber-400" },
  closed_wc:     { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-400" },
  closed_wpp:    { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-400" },
  closed_other:  { bg: "bg-green-100 dark:bg-green-900/40", text: "text-green-700 dark:text-green-400" },
  lost:          { bg: "bg-red-100 dark:bg-red-900/40",   text: "text-red-700 dark:text-red-400" },
};

function isStale(session: SessionWithCount): boolean {
  if (session.status !== "following_up") return false;
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  return new Date(session.updatedAt) < threeDaysAgo;
}

export default function PresupuestosPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState<number | null>(null);

  const handleDuplicate = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    setDuplicating(sessionId);
    try {
      const res = await fetch(`/api/quote-sessions/${sessionId}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error();
      const newSession = await res.json() as QuoteSession;
      toast.success("Presupuesto duplicado");
      router.push(`/presupuestos/${newSession.id}`);
    } catch {
      toast.error("Error al duplicar");
      setDuplicating(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quote-sessions");
      if (res.ok) setSessions(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = sessions.filter((s) =>
    statusFilter === "all" ? true : s.status === statusFilter
  );

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/quote-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: newName,
          clientPhone: newPhone || undefined,
          clientEmail: newEmail || undefined,
        }),
      });
      if (res.ok) {
        const session = await res.json() as QuoteSession;
        router.push(`/presupuestos/${session.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const openDialog = () => {
    setNewName(""); setNewPhone(""); setNewEmail("");
    setCreating(true);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Presupuestos</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Seguimiento de presupuestos y clientes
          </p>
        </div>
        <Button onClick={openDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo presupuesto
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Filtrar por estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {(Object.keys(STATUS_LABELS) as QuoteSessionStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay presupuestos</p>
          <p className="text-sm mt-1">
            {statusFilter === "all"
              ? "Creá el primero con el botón de arriba"
              : "No hay presupuestos con este estado"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((session) => {
            const stale = isStale(session);
            const sv = STATUS_VARIANTS[session.status];
            return (
              <button
                key={session.id}
                className={`w-full text-left rounded-lg border p-4 hover:shadow-md transition-all flex items-center gap-4 ${
                  stale
                    ? "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20"
                    : "border-border bg-card hover:bg-accent/20"
                }`}
                onClick={() => router.push(`/presupuestos/${session.id}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-base">{session.clientName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sv.bg} ${sv.text}`}>
                      {STATUS_LABELS[session.status]}
                    </span>
                    {stale && (
                      <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <Clock className="h-3 w-3" />
                        +3 días sin actualizar
                      </span>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                    {session.clientPhone && (
                      <span className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {session.clientPhone}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      {session.quoteCount === 0
                        ? "Sin opciones"
                        : `${session.quoteCount} opción${session.quoteCount !== 1 ? "es" : ""}`}
                    </span>
                    <span>
                      Actualizado {new Date(session.updatedAt).toLocaleDateString("es-AR")}
                    </span>
                  </div>
                </div>
                <button
                  className="p-1.5 rounded hover:bg-muted transition-colors shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => handleDuplicate(e, session.id)}
                  disabled={duplicating === session.id}
                  title="Duplicar presupuesto"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={(v) => { if (!v) setCreating(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo presupuesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-name">
                Nombre del cliente <span className="text-primary">*</span>
              </Label>
              <Input
                id="new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Juan García"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-phone">Teléfono</Label>
              <Input
                id="new-phone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="11 1234-5678"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="juan@mail.com"
                type="email"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={!newName.trim() || saving}>
              {saving ? "Creando..." : "Crear y abrir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
