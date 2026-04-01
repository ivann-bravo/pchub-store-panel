import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");

// PATCH /api/admin/users/[id] — update user (SUPER_ADMIN only)
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return Response.json({ error: "Forbidden" }, { status: 403 });

  const targetId = parseInt(params.id);
  const currentUserId = parseInt(session.user.id ?? "0");

  try {
    const body = await req.json() as {
      name?: string; role?: string; isActive?: boolean; password?: string;
    };

    const sqlite = new Database(dbPath);
    try {
      const target = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(targetId) as { id: number } | undefined;
      if (!target) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });

      // Can't demote yourself or deactivate yourself
      if (targetId === currentUserId) {
        if (body.role && body.role !== "SUPER_ADMIN") {
          return Response.json({ error: "No podés cambiar tu propio rol" }, { status: 400 });
        }
        if (body.isActive === false) {
          return Response.json({ error: "No podés desactivar tu propia cuenta" }, { status: 400 });
        }
      }

      if (body.role && !["SUPER_ADMIN", "VIEWER"].includes(body.role)) {
        return Response.json({ error: "Rol inválido" }, { status: 400 });
      }

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) { updates.push("name = ?"); values.push(body.name); }
      if (body.role !== undefined) { updates.push("role = ?"); values.push(body.role); }
      if (body.isActive !== undefined) { updates.push("is_active = ?"); values.push(body.isActive ? 1 : 0); }
      if (body.password !== undefined) {
        if (body.password.length < 8) {
          return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
        }
        const hash = await bcrypt.hash(body.password, 12);
        updates.push("password_hash = ?");
        values.push(hash);
      }

      if (updates.length === 0) return Response.json({ error: "Sin cambios" }, { status: 400 });

      updates.push("updated_at = datetime('now')");
      values.push(targetId);

      sqlite.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

      const updated = sqlite
        .prepare("SELECT id, email, name, role, is_active, totp_enabled, last_login_at, created_at FROM users WHERE id = ?")
        .get(targetId) as { id: number; email: string; name: string; role: string; is_active: number; totp_enabled: number; last_login_at: string | null; created_at: string | null };
      return Response.json({
        id: updated.id, email: updated.email, name: updated.name, role: updated.role,
        isActive: !!updated.is_active, totpEnabled: !!updated.totp_enabled,
        lastLoginAt: updated.last_login_at, createdAt: updated.created_at,
      });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ error: "Error al actualizar usuario" }, { status: 500 });
  }
}

// DELETE /api/admin/users/[id] — hard-delete user (SUPER_ADMIN only)
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") return Response.json({ error: "Forbidden" }, { status: 403 });

  const targetId = parseInt(params.id);
  const currentUserId = parseInt(session.user.id ?? "0");

  if (targetId === currentUserId) {
    return Response.json({ error: "No podés eliminar tu propia cuenta" }, { status: 400 });
  }

  const sqlite = new Database(dbPath);
  try {
    const target = sqlite.prepare("SELECT id FROM users WHERE id = ?").get(targetId);
    if (!target) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });

    sqlite.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    return Response.json({ success: true });
  } finally {
    sqlite.close();
  }
}
