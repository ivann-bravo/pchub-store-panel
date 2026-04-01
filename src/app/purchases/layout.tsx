import type { Metadata } from "next";
export const metadata: Metadata = { title: "Órdenes de Compra" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
