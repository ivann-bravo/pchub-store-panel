import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { verifyTOTPCode } from "@/lib/totp";

function resolveAuthDbPath(): string {
  if (process.env.DEMO_MODE === "true") {
    const tmpPath = "/tmp/pchub-demo.db";
    if (!fs.existsSync(tmpPath)) {
      const seedPath = path.join(process.cwd(), "data", "demo-seed.db");
      fs.copyFileSync(seedPath, tmpPath);
    }
    return tmpPath;
  }
  return path.join(process.cwd(), "data", "pchub-demo.db");
}

interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  role: "SUPER_ADMIN" | "VIEWER";
  is_active: number;
  totp_enabled: number;
  totp_secret: string | null;
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
        totpCode: { label: "Código TOTP", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const sqlite = new Database(resolveAuthDbPath());
        sqlite.pragma("journal_mode = WAL");
        sqlite.pragma("busy_timeout = 5000");
        try {
          const email = credentials.email.trim().toLowerCase();
          const user = sqlite
            .prepare("SELECT * FROM users WHERE LOWER(email) = ? LIMIT 1")
            .get(email) as UserRow | undefined;

          if (!user || !user.is_active) return null;

          const passwordValid = await bcrypt.compare(credentials.password, user.password_hash);
          if (!passwordValid) return null;

          // TOTP verification (if enabled)
          if (user.totp_enabled && user.totp_secret) {
            const code = (credentials.totpCode as string | undefined)?.trim();
            if (!code) return null;
            if (!verifyTOTPCode(user.totp_secret, code)) return null;
          }

          // Record login timestamp
          sqlite
            .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
            .run(user.id);

          return {
            id: String(user.id),
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } finally {
          sqlite.close();
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role: "SUPER_ADMIN" | "VIEWER" }).role;
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
};
