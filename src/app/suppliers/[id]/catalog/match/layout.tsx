import type { Metadata } from "next";
export const metadata: Metadata = { title: "Match de Catálogo" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
