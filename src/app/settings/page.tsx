"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { Shield, Users, ChevronRight, KeyRound, Smartphone, ShoppingCart } from "lucide-react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        description="Administrá tu cuenta y los usuarios del sistema"
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Security */}
        <Link href="/settings/security" className="group">
          <Card className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
              </div>
              <CardTitle className="text-base mt-3">Seguridad</CardTitle>
              <CardDescription>Contraseña y verificación en dos pasos</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {[
                  { icon: KeyRound, label: "Cambiar contraseña" },
                  { icon: Smartphone, label: "Autenticador 2FA (TOTP)" },
                ].map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="h-3 w-3 shrink-0" />
                    {label}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </Link>

        {/* WooCommerce */}
        {isSuperAdmin && (
          <Link href="/settings/woocommerce" className="group">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
                </div>
                <CardTitle className="text-base mt-3">WooCommerce</CardTitle>
                <CardDescription>Conexión, categorías y atributos</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {[
                    "Estado de la conexión",
                    "Sincronización de categorías",
                    "Mapeo de atributos",
                  ].map((label) => (
                    <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                      {label}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Users — only visible to SUPER_ADMIN */}
        {isSuperAdmin && (
          <Link href="/settings/users" className="group">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 group-hover:bg-primary/15 transition-colors">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
                </div>
                <CardTitle className="text-base mt-3">Usuarios</CardTitle>
                <CardDescription>Crear, editar y administrar accesos</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {[
                    "Crear usuarios con roles",
                    "Activar / desactivar cuentas",
                    "Restablecer contraseñas",
                  ].map((label) => (
                    <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                      {label}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </div>
  );
}
