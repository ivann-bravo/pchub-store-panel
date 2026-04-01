import type { Metadata } from "next";
export const metadata: Metadata = { title: "Combos y PCs" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
