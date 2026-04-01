import type { Metadata } from "next";
export const metadata: Metadata = { title: "Alertas de Precio" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
