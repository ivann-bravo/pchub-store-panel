import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: string;
  is_active: number;
  totp_enabled: number;
  last_login_at: string | null;
  created_at: string | null;
}

function safeUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: !!u.is_active,
    totpEnabled: !!u.totp_enabled,
    lastLoginAt: u.last_login_at,
    createdAt: u.created_at,
  };
}

// GET /api/admin/users — list all users (SUPER_ADMIN only)
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return Response.json({ error: "Forbidden" }, { status: 403 });

  const sqlite = new Database(dbPath);
  try {
    const users = sqlite
      .prepare("SELECT id, email, name, role, is_active, totp_enabled, last_login_at, created_at FROM users ORDER BY created_at ASC")
      .all() as UserRow[];
    return Response.json(users.map(safeUser));
  } finally {
    sqlite.close();
  }
}

// POST /api/admin/users — create user (SUPER_ADMIN only)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { email, name, password, role } = await req.json() as {
      email?: string; name?: string; password?: string; role?: string;
    };

    if (!email || !name || !password) {
      return Response.json({ error: "Email, nombre y contraseña son obligatorios" }, { status: 400 });
    }
    if (!["SUPER_ADMIN", "VIEWER"].includes(role ?? "")) {
      return Response.json({ error: "Rol inválido" }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const sqlite = new Database(dbPath);
    try {
      const existing = sqlite.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);
      if (existing) {
        return Response.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });
      }
      const result = sqlite
        .prepare("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)")
        .run(email.toLowerCase(), passwordHash, name, role ?? "VIEWER");

      const created = sqlite
        .prepare("SELECT id, email, name, role, is_active, totp_enabled, last_login_at, created_at FROM users WHERE id = ?")
        .get(result.lastInsertRowid) as UserRow;
      return Response.json(safeUser(created), { status: 201 });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ error: "Error al crear usuario" }, { status: 500 });
  }
}
