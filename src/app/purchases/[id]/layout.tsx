import type { Metadata } from "next";
export const metadata: Metadata = { title: "Orden de Compra" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
