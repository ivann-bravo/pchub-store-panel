"use client";

import { useSidebar } from "./sidebar-context";

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();

  return (
    <main
      className={`min-h-screen bg-background p-6 transition-[margin-left] duration-300 ease-in-out ${
        collapsed ? "ml-16" : "ml-64"
      }`}
    >
      {children}
    </main>
  );
}
