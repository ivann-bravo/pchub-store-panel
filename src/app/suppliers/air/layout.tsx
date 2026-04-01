import type { Metadata } from "next";
export const metadata: Metadata = { title: "Air" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
