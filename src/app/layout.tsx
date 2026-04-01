import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { AppShell } from "@/components/layout/app-shell";
import { AutoSyncManager } from "@/components/auto-sync-manager";
import { SessionProvider } from "@/components/providers/session-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "PCHub Store Panel",
    template: "%s · PCHub Store Panel",
  },
  description: "Admin panel for PCHub Argentina",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <SessionProvider>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
            <Toaster richColors position="top-right" />
            <AutoSyncManager />
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
