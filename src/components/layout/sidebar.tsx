"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  Truck,
  DollarSign,
  Settings,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  Layers,
  LogOut,
  User,
  Sparkles,
  ShieldAlert,
  TrendingUp,
  ShoppingCart,
  ShoppingBag,
  ImagePlay,
  History,
  EyeOff,
  Wrench,
  FileText,
  Building2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useSidebar } from "./sidebar-context";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  viewerHidden?: boolean;
  exactActive?: boolean;
  activePaths?: string[];
  showBadge?: boolean;
  subItems?: { href: string; label: string }[];
};

type NavSection = {
  label?: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, exactActive: true },
    ],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/products", label: "Productos", icon: Package },
      {
        href: "/combos",
        label: "Combos y PCs",
        icon: Layers,
        subItems: [{ href: "/combos/buscador", label: "Buscador" }],
      },
      { href: "/descriptions", label: "Descripciones", icon: Sparkles, viewerHidden: true },
      { href: "/products/images", label: "Imágenes", icon: ImagePlay, viewerHidden: true },
    ],
  },
  {
    label: "Precios",
    items: [
      { href: "/pricing", label: "Motor de Precios", icon: DollarSign, viewerHidden: true, exactActive: true },
      { href: "/pricing/alerts", label: "Alertas de Precio", icon: Bell },
      { href: "/pricing/exchange-rates", label: "Cotización USD", icon: TrendingUp, viewerHidden: true },
    ],
  },
  {
    label: "Proveedores",
    items: [
      { href: "/suppliers", label: "Proveedores", icon: Truck },
      { href: "/purchases", label: "Órdenes de Compra", icon: ShoppingBag, viewerHidden: true },
    ],
  },
  {
    label: "Ventas",
    items: [
      { href: "/presupuestos", label: "Presupuestos", icon: FileText, showBadge: true, activePaths: ["/presupuestos"] },
    ],
  },
  {
    label: "WooCommerce",
    items: [
      { href: "/woocommerce/revision", label: "Syncs Bloqueados", icon: ShieldAlert, showBadge: true },
      { href: "/woocommerce/sync-log", label: "Historial de Sync", icon: History },
      { href: "/products?wooManualPrivate=1", label: "Pausados manualmente", icon: EyeOff },
      { href: "/settings/woocommerce", label: "Configuración WC", icon: ShoppingCart, viewerHidden: true },
    ],
  },
];

const settingsNavItems: NavItem[] = [
  {
    href: "/settings",
    label: "Configuración",
    icon: Settings,
    exactActive: true,
    activePaths: ["/settings/security", "/settings/users"],
  },
  {
    href: "/settings/empresa",
    label: "Datos de Empresa",
    icon: Building2,
    viewerHidden: true,
    exactActive: true,
  },
  {
    href: "/admin/tools",
    label: "Herramientas Admin",
    icon: Wrench,
    viewerHidden: true,
    exactActive: true,
  },
];

function getIsActive(item: NavItem, pathname: string): boolean {
  const directMatch = item.exactActive
    ? pathname === item.href
    : item.href === "/"
    ? pathname === "/"
    : pathname === item.href || pathname.startsWith(item.href + "/");
  const extraMatch = item.activePaths?.some((p) => pathname.startsWith(p)) ?? false;
  return directMatch || extraMatch;
}

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { collapsed, toggle } = useSidebar();
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";

  const [wooBlockedCount, setWooBlockedCount] = useState(0);
  const [quoteFollowUpCount, setQuoteFollowUpCount] = useState(0);
  useEffect(() => {
    fetch("/api/woocommerce/sync-blocked?status=pending&limit=1")
      .then((r) => r.json())
      .then((d) => setWooBlockedCount(d.pendingCount ?? 0))
      .catch(() => {});
    fetch("/api/quote-sessions?needsFollowUp=1")
      .then((r) => r.json())
      .then((d: { count?: number }) => setQuoteFollowUpCount(d.count ?? 0))
      .catch(() => {});
  }, [pathname]);

  const renderNavItem = (item: NavItem) => {
    if (item.viewerHidden && isViewer) return null;
    const isActive = getIsActive(item, pathname);

    return (
      <div key={item.href}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={item.href}
              className={cn(
                "relative flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed ? "justify-center" : "gap-3",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-muted hover:text-sidebar-foreground",
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 bg-primary rounded-r-full" />
              )}
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && item.showBadge && item.href === "/presupuestos" && quoteFollowUpCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                  {quoteFollowUpCount}
                </Badge>
              )}
              {!collapsed && item.showBadge && item.href !== "/presupuestos" && wooBlockedCount > 0 && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4">
                  {wooBlockedCount}
                </Badge>
              )}
            </Link>
          </TooltipTrigger>
          {collapsed && (
            <TooltipContent side="right">
              {item.label}
              {item.showBadge && wooBlockedCount > 0 && ` (${wooBlockedCount})`}
            </TooltipContent>
          )}
        </Tooltip>

        {/* Sub-items: always visible when sidebar is expanded */}
        {!collapsed && item.subItems && (
          <div className="ml-7 mt-0.5 space-y-0.5">
            {item.subItems.map((sub) => {
              const isSubActive = pathname === sub.href || pathname.startsWith(sub.href + "/");
              return (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    isSubActive
                      ? "text-primary bg-primary/10"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-muted",
                  )}
                >
                  {sub.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border transition-[width] duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Logo / Title */}
      <div className="flex h-16 items-center px-4 shrink-0">
        {collapsed ? (
          <div className="flex w-full justify-center">
            <Image src="/isotipo.svg" alt="PCHub" width={28} height={28} className="h-7 w-7 dark:invert-0 invert" />
          </div>
        ) : (
          <div className="flex items-center gap-3 px-2">
            <Image src="/logo.svg" alt="PCHub Argentina" width={160} height={56} className="h-14 w-auto dark:invert-0 invert" />
          </div>
        )}
      </div>

      <div className="mx-3 border-t border-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-hide px-2 py-3">
        <TooltipProvider delayDuration={0}>
          <div className="space-y-3">
            {navSections.map((section, sectionIdx) => {
              const visibleItems = section.items.filter(
                (item) => !item.viewerHidden || !isViewer,
              );
              if (visibleItems.length === 0) return null;

              return (
                <div key={sectionIdx}>
                  {section.label && !collapsed && (
                    <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                      {section.label}
                    </p>
                  )}
                  {section.label && collapsed && sectionIdx > 0 && (
                    <div className="mx-2 border-t border-sidebar-border/40" />
                  )}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => renderNavItem(item))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Settings section */}
          <div className="mt-3 pt-3 border-t border-sidebar-border">
            {!collapsed && (
              <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                Sistema
              </p>
            )}
            <div className="space-y-0.5">
              {settingsNavItems.map((item) => renderNavItem(item))}
            </div>
          </div>
        </TooltipProvider>
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-sidebar-border shrink-0">
        <TooltipProvider delayDuration={0}>
          {/* Toggle collapse */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={toggle}
                className={cn(
                  "flex w-full items-center rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-muted hover:text-sidebar-foreground transition-colors",
                  collapsed ? "justify-center" : "gap-3",
                )}
                aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4 shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose className="h-4 w-4 shrink-0" />
                    <span>Colapsar</span>
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && <TooltipContent side="right">Expandir</TooltipContent>}
          </Tooltip>

          {/* Theme toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className={cn(
                  "flex w-full items-center rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-muted hover:text-sidebar-foreground transition-colors",
                  collapsed ? "justify-center" : "gap-3",
                )}
                aria-label="Toggle theme"
              >
                {theme === "dark" ? (
                  <>
                    <Sun className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Modo claro</span>}
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Modo oscuro</span>}
                  </>
                )}
              </button>
            </TooltipTrigger>
            {collapsed && (
              <TooltipContent side="right">
                {theme === "dark" ? "Modo claro" : "Modo oscuro"}
              </TooltipContent>
            )}
          </Tooltip>

          {/* User info + logout */}
          {session?.user && (
            <div className="mt-2 pt-2 border-t border-sidebar-border">
              {!collapsed && (
                <div className="flex items-center gap-2 px-3 py-1.5 mb-1">
                  <User className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-sidebar-foreground truncate">
                      {session.user.name}
                    </p>
                    <p className="text-[10px] text-sidebar-foreground/50 truncate">
                      {session.user.role === "SUPER_ADMIN" ? "Super Admin" : "Viewer"}
                    </p>
                  </div>
                </div>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className={cn(
                      "flex w-full items-center rounded-md px-3 py-2 text-sm text-sidebar-foreground/60 hover:bg-sidebar-muted hover:text-sidebar-foreground transition-colors",
                      collapsed ? "justify-center" : "gap-3",
                    )}
                    aria-label="Cerrar sesión"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    {!collapsed && <span>Cerrar sesión</span>}
                  </button>
                </TooltipTrigger>
                {collapsed && <TooltipContent side="right">Cerrar sesión</TooltipContent>}
              </Tooltip>
            </div>
          )}
        </TooltipProvider>

        {!collapsed && (
          <p className="mt-3 text-xs text-sidebar-foreground/40 px-3">
            &copy; {new Date().getFullYear()} PCHub Argentina
          </p>
        )}
      </div>
    </aside>
  );
}
