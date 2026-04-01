"use client";

import { createContext, useContext, useState, useEffect } from "react";

interface SidebarContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

const STORAGE_KEY = "sidebar-collapsed";

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsedState(true);
    setMounted(true);
  }, []);

  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    localStorage.setItem(STORAGE_KEY, String(value));
  };

  const toggle = () => setCollapsed(!collapsed);

  // Avoid layout flash by not rendering children until mounted
  if (!mounted) {
    return <>{children}</>;
  }

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
