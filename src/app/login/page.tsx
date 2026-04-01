"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Package, Truck, BarChart3, Shield, ArrowLeft, ShieldCheck } from "lucide-react";

// ─── Feature bullets shown on the brand panel ─────────────────────────────────
const features = [
  { icon: Package, label: "Gestión de productos y precios" },
  { icon: Truck, label: "Sincronización con 13 proveedores" },
  { icon: BarChart3, label: "Historial de precios en tiempo real" },
  { icon: Shield, label: "Acceso seguro con roles" },
];

// ─── Brand panel ──────────────────────────────────────────────────────────────
function BrandPanel() {
  return (
    <div className="relative hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col overflow-hidden bg-[hsl(222,47%,11%)]">
      {/* Orange glow top-right */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[480px] w-[480px] rounded-full opacity-20"
        style={{ background: "radial-gradient(circle, #FF4605 0%, transparent 70%)" }}
      />
      {/* Subtle grid texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(210,40%,98%) 1px, transparent 1px), linear-gradient(90deg, hsl(210,40%,98%) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      {/* Bottom orange glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-20 h-[380px] w-[380px] rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #FF4605 0%, transparent 70%)" }}
      />

      <div className="relative z-10 flex flex-1 flex-col justify-between p-10 xl:p-12">
        {/* Logo */}
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="PCHub Argentina" className="h-12 w-auto brightness-0 invert" />
        </div>

        {/* Main copy */}
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#FF4605]">
              Panel de Control
            </p>
            <h1 className="text-3xl xl:text-4xl font-bold text-white leading-tight">
              Gestión centralizada
              <br />
              de precios y<br />
              <span className="text-[#FF4605]">proveedores.</span>
            </h1>
          </div>

          <ul className="space-y-3">
            {features.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="h-3.5 w-3.5 text-[#FF4605]" />
                </span>
                <span className="text-sm text-white/70">{label}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <p className="text-xs text-white/30">
          &copy; {new Date().getFullYear()} PCHub Argentina &mdash; Uso interno
        </p>
      </div>
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── Login form (needs Suspense for useSearchParams) ───────────────────────────
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  // Step 1: email + password | Step 2: TOTP code
  const [step, setStep] = useState<"credentials" | "totp">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Step 1 submit: pre-check TOTP requirement, then either go to step 2 or sign in
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/totp-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { required: boolean };

      if (data.required) {
        // Move to TOTP step
        setStep("totp");
        setLoading(false);
        return;
      }

      // No TOTP required — sign in directly
      await doSignIn("");
    } catch {
      setLoading(false);
      setError("Error de conexión. Intentá de nuevo.");
    }
  }

  // Step 2 submit: sign in with all three fields
  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    await doSignIn(totpCode);
  }

  async function doSignIn(code: string) {
    const result = await signIn("credentials", {
      email,
      password,
      totpCode: code,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (step === "totp" || code) {
        setError("Código incorrecto. Verificá que la hora de tu teléfono sea correcta.");
      } else {
        setError("Email o contraseña incorrectos.");
      }
    } else {
      router.push(callbackUrl);
      router.refresh();
    }
  }

  // ── Step 1: credentials ──────────────────────────────────────────────────────
  if (step === "credentials") {
    return (
      <form onSubmit={handleCredentials} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder="admin@pchub.com.ar"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <Button type="submit" className="h-11 w-full cursor-pointer text-sm font-semibold" disabled={loading}>
          {loading ? (
            <span className="flex items-center gap-2"><Spinner />Verificando…</span>
          ) : (
            "Continuar"
          )}
        </Button>
      </form>
    );
  }

  // ── Step 2: TOTP code ────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleTotp} className="space-y-5">
      {/* TOTP badge */}
      <div className="flex items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[#FF4605]" />
        <div>
          <p className="text-sm font-medium">Verificación en dos pasos</p>
          <p className="text-xs text-muted-foreground">
            Ingresá el código de tu aplicación autenticadora
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="totp" className="text-sm font-medium">Código de 6 dígitos</Label>
        <Input
          id="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          placeholder="123456"
          maxLength={6}
          value={totpCode}
          onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
          className="h-11 text-center text-lg tracking-[0.4em] font-mono"
          autoFocus
        />
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      <Button type="submit" className="h-11 w-full cursor-pointer text-sm font-semibold" disabled={loading}>
        {loading ? (
          <span className="flex items-center gap-2"><Spinner />Verificando…</span>
        ) : (
          "Ingresar"
        )}
      </Button>

      <button
        type="button"
        onClick={() => { setStep("credentials"); setError(""); setTotpCode(""); }}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Volver
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      <BrandPanel />

      {/* Form side */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-[360px] space-y-8">
          {/* Mobile logo (only visible below lg) */}
          <div className="flex justify-center lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.svg"
              alt="PCHub Argentina"
              className="h-10 w-auto dark:invert-0 invert"
            />
          </div>

          {/* Heading */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Bienvenido</h2>
            <p className="text-sm text-muted-foreground">
              Ingresá tus credenciales para continuar
            </p>
          </div>

          {/* Demo credentials banner */}
          {process.env.NEXT_PUBLIC_DEMO_MODE === "true" && (
            <div className="rounded-lg border border-amber-300/50 bg-amber-50/80 dark:bg-amber-950/30 px-4 py-3 space-y-1">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                Credenciales de Demo
              </p>
              <p className="text-sm font-mono text-amber-800 dark:text-amber-300">admin@pchub.com.ar</p>
              <p className="text-sm font-mono text-amber-800 dark:text-amber-300">demo123</p>
            </div>
          )}

          {/* Form with Suspense for useSearchParams */}
          <Suspense fallback={<div className="h-[220px]" />}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
