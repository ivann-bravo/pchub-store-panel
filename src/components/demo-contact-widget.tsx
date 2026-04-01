"use client";
import { useState } from "react";
import { X, MessageCircle } from "lucide-react";

export function DemoContactWidget() {
  const [open, setOpen] = useState(false);

  if (process.env.NEXT_PUBLIC_DEMO_MODE !== "true") return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 rounded-2xl border bg-card shadow-2xl p-5 space-y-4 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className="flex items-start justify-between gap-2">
            <img src="/avanzio-logo.svg" alt="Avanzio" className="h-6 w-auto dark:hidden" />
            <img src="/avanzio-logo-dark.svg" alt="Avanzio" className="h-6 w-auto hidden dark:block" />
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-foreground leading-relaxed">
            ¿Te gusta lo que ves? Esto es solo una demo muy limitada para tener un pantallazo del sistema.
          </p>
          <p className="text-sm text-muted-foreground">
            Si querés algo así para tu negocio, contactanos.
          </p>
          <a
            href="https://avanzio.ar/contacto"
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center rounded-lg bg-[#FF4605] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e03e04] transition-colors"
          >
            Hablar con el equipo →
          </a>
        </div>
      )}

      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full bg-[#FF4605] px-4 py-3 text-white shadow-lg hover:bg-[#e03e04] transition-all hover:scale-105 active:scale-95"
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
        {!open && <span className="text-sm font-semibold pr-1">¿Te interesa?</span>}
      </button>
    </div>
  );
}
