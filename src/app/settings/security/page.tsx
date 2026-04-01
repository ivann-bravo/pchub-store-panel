"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, ShieldCheck, ShieldOff, Smartphone, Copy, Check } from "lucide-react";

// ─── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── Change password ───────────────────────────────────────────────────────────
function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);

    if (next !== confirm) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    if (next.length < 8) {
      setError("La contraseña nueva debe tener al menos 8 caracteres.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Error al cambiar contraseña.");
      } else {
        setSuccess(true);
        setCurrent("");
        setNext("");
        setConfirm("");
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <KeyRound className="h-4 w-4 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base">Cambiar contraseña</CardTitle>
            <CardDescription>Actualizá tu contraseña de acceso al panel</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="current-pw">Contraseña actual</Label>
            <Input
              id="current-pw"
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">Nueva contraseña</Label>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pw">Confirmar nueva contraseña</Label>
            <Input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-10"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
          {success && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
              <p className="text-sm text-green-600 dark:text-green-400">Contraseña actualizada correctamente.</p>
            </div>
          )}

          <Button type="submit" disabled={loading} className="cursor-pointer">
            {loading ? <span className="flex items-center gap-2"><Spinner />Guardando…</span> : "Guardar contraseña"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── TOTP setup ───────────────────────────────────────────────────────────────
interface TotpStatus {
  enabled: boolean;
  hasSecret: boolean;
}

interface SetupData {
  qrCodeDataUrl: string;
  manualKey: string;
  uri: string;
}

function TotpCard() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);
  const [showDisableDialog, setShowDisableDialog] = useState(false);

  async function fetchStatus() {
    try {
      const res = await fetch("/api/settings/totp");
      const data = (await res.json()) as TotpStatus;
      setStatus(data);
    } catch {
      // ignore
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => {
    fetchStatus();
  }, []);

  async function startSetup() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/settings/totp", { method: "POST" });
      const data = (await res.json()) as SetupData & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Error al generar código QR.");
      } else {
        setSetup(data);
        setVerifyCode("");
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/totp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Código incorrecto.");
      } else {
        setSuccess("2FA activado correctamente. Guardá tu app autenticadora.");
        setSetup(null);
        setVerifyCode("");
        await fetchStatus();
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/settings/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Código incorrecto.");
      } else {
        setSuccess("2FA desactivado.");
        setShowDisableDialog(false);
        setDisableCode("");
        await fetchStatus();
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    if (!setup?.manualKey) return;
    navigator.clipboard.writeText(setup.manualKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (statusLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Spinner className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Smartphone className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">Verificación en dos pasos (2FA)</CardTitle>
                <CardDescription>Protegé tu cuenta con una aplicación autenticadora</CardDescription>
              </div>
            </div>
            <Badge variant={status?.enabled ? "default" : "secondary"}>
              {status?.enabled ? "Activado" : "Desactivado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {success && (
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2">
              <p className="text-sm text-green-600 dark:text-green-400">{success}</p>
            </div>
          )}

          {/* Already enabled */}
          {status?.enabled && !setup && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                <span>Tu cuenta tiene 2FA activado. Cada vez que iniciás sesión se te pedirá un código.</span>
              </div>
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => { setShowDisableDialog(true); setError(""); }}
              >
                <ShieldOff className="mr-2 h-4 w-4" />
                Desactivar 2FA
              </Button>
            </div>
          )}

          {/* Not enabled, no setup in progress */}
          {!status?.enabled && !setup && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Usá Google Authenticator, Authy, o cualquier app compatible con TOTP para agregar
                una capa extra de seguridad a tu cuenta.
              </p>
              <Button onClick={startSetup} disabled={loading} className="cursor-pointer">
                {loading ? (
                  <span className="flex items-center gap-2"><Spinner />Generando…</span>
                ) : (
                  <>
                    <ShieldCheck className="mr-2 h-4 w-4" />
                    Configurar 2FA
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Setup in progress */}
          {setup && (
            <div className="space-y-5">
              <div className="space-y-1">
                <p className="text-sm font-medium">Paso 1: Escaneá el código QR</p>
                <p className="text-xs text-muted-foreground">
                  Abrí tu app autenticadora y escaneá el código, o ingresá la clave manualmente.
                </p>
              </div>

              {/* QR + manual key side by side */}
              <div className="flex flex-col sm:flex-row gap-5 items-start">
                <div className="rounded-xl border bg-white p-3 shadow-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={setup.qrCodeDataUrl} alt="Código QR para 2FA" className="h-40 w-40" />
                </div>

                <div className="space-y-2 flex-1">
                  <p className="text-xs text-muted-foreground">Clave manual:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                      {setup.manualKey}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0 cursor-pointer"
                      onClick={copyKey}
                      title="Copiar clave"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Guardá esta clave en un lugar seguro por si perdés acceso a tu teléfono.
                  </p>
                </div>
              </div>

              <form onSubmit={handleEnable} className="space-y-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Paso 2: Verificá el código</p>
                  <p className="text-xs text-muted-foreground">
                    Ingresá el código de 6 dígitos que muestra tu app para confirmar la configuración.
                  </p>
                </div>
                <div className="flex gap-2 max-w-xs">
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    placeholder="123456"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                    className="h-10 font-mono text-center tracking-widest text-base"
                    autoFocus
                  />
                  <Button type="submit" disabled={loading || verifyCode.length < 6} className="cursor-pointer shrink-0">
                    {loading ? <Spinner /> : "Activar"}
                  </Button>
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
                <button
                  type="button"
                  onClick={() => { setSetup(null); setError(""); }}
                  className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancelar
                </button>
              </form>
            </div>
          )}

          {/* Error outside setup flow */}
          {error && !setup && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disable dialog */}
      <Dialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar 2FA</DialogTitle>
            <DialogDescription>
              Ingresá tu código actual de la app autenticadora para confirmar que querés desactivar 2FA.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDisable} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="disable-code">Código de 6 dígitos</Label>
              <Input
                id="disable-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                placeholder="123456"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                className="h-10 font-mono text-center tracking-widest text-base"
                autoFocus
              />
            </div>
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                onClick={() => { setShowDisableDialog(false); setDisableCode(""); setError(""); }}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="cursor-pointer"
                disabled={loading || disableCode.length < 6}
              >
                {loading ? <span className="flex items-center gap-2"><Spinner />Desactivando…</span> : "Desactivar 2FA"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SecuritySettingsPage() {
  const { data: session } = useSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Seguridad</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Administrá tu contraseña y la verificación en dos pasos
          {session?.user?.email ? ` — ${session.user.email}` : ""}
        </p>
      </div>

      <ChangePasswordCard />
      <TotpCard />
    </div>
  );
}
