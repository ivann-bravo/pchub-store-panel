import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");

// POST /api/settings/password — change own password
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id ?? "0");

  try {
    const { currentPassword, newPassword } = await req.json() as {
      currentPassword?: string; newPassword?: string;
    };

    if (!currentPassword || !newPassword) {
      return Response.json({ error: "Contraseña actual y nueva son obligatorias" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return Response.json({ error: "La contraseña debe tener al menos 8 caracteres" }, { status: 400 });
    }

    const sqlite = new Database(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT password_hash FROM users WHERE id = ?")
        .get(userId) as { password_hash: string } | undefined;

      if (!row) return Response.json({ error: "Usuario no encontrado" }, { status: 404 });

      const valid = await bcrypt.compare(currentPassword, row.password_hash);
      if (!valid) return Response.json({ error: "Contraseña actual incorrecta" }, { status: 422 });

      const newHash = await bcrypt.hash(newPassword, 12);
      sqlite
        .prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
        .run(newHash, userId);

      return Response.json({ success: true });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ error: "Error al cambiar contraseña" }, { status: 500 });
  }
}
