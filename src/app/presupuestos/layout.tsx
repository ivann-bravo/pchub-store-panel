import type { Metadata } from "next";
export const metadata: Metadata = { title: "Presupuestos" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
