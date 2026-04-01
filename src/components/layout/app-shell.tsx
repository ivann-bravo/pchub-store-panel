"use client";

import { usePathname } from "next/navigation";
import { SidebarProvider } from "./sidebar-context";
import { Sidebar } from "./sidebar";
import { MainContent } from "./main-content";
import { DemoContactWidget } from "@/components/demo-contact-widget";

const AUTH_ROUTES = ["/login"];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  if (isAuthRoute) {
    return (
      <>
        {children}
        <DemoContactWidget />
      </>
    );
  }

  return (
    <SidebarProvider>
      <Sidebar />
      <MainContent>{children}</MainContent>
      <DemoContactWidget />
    </SidebarProvider>
  );
}
