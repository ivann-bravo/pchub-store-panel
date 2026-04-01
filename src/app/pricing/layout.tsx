import type { Metadata } from "next";
export const metadata: Metadata = { title: "Motor de Precios" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
