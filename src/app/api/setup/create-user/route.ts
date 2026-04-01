import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import type { DB } from "@/lib/db";

// POST /api/setup/create-user
// Emergency endpoint to create a user — requires SETUP_SECRET env var.
// Use when locked out or when users need to be seeded without admin access.
export async function POST(req: Request) {
  const setupSecret = process.env.SETUP_SECRET;
  if (!setupSecret) {
    return Response.json({ error: "SETUP_SECRET not configured" }, { status: 500 });
  }

  try {
    const { secret, email, password, name, role } = await req.json() as {
      secret?: string;
      email?: string;
      password?: string;
      name?: string;
      role?: string;
    };

    if (!secret || secret !== setupSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!email || !password || !name) {
      return Response.json({ error: "email, password and name are required" }, { status: 400 });
    }

    const normalizedRole = role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "VIEWER";
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);

    // Access $client to trigger lazy DB init (creates tables if needed)
    const sqlite = (db as DB).$client;

    const existing = sqlite
      .prepare("SELECT id FROM users WHERE LOWER(email) = ?")
      .get(normalizedEmail);

    if (existing) {
      sqlite
        .prepare("UPDATE users SET password_hash = ?, name = ?, role = ?, is_active = 1 WHERE LOWER(email) = ?")
        .run(passwordHash, name, normalizedRole, normalizedEmail);
      return Response.json({ success: true, action: "updated", email: normalizedEmail });
    }

    sqlite
      .prepare("INSERT INTO users (email, password_hash, name, role, is_active) VALUES (?, ?, ?, ?, 1)")
      .run(normalizedEmail, passwordHash, name, normalizedRole);

    return Response.json({ success: true, action: "created", email: normalizedEmail });
  } catch (err) {
    console.error("[create-user]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
