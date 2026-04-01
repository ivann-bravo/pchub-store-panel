import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import Database from "better-sqlite3";
import path from "path";
import QRCode from "qrcode";
import { generateTOTPSecret, getTOTPUri, verifyTOTPCode } from "@/lib/totp";

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");

// GET /api/settings/totp — return current TOTP status
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id ?? "0");
  const sqlite = new Database(dbPath);
  try {
    const row = sqlite
      .prepare("SELECT totp_enabled, totp_secret FROM users WHERE id = ?")
      .get(userId) as { totp_enabled: number; totp_secret: string | null } | undefined;
    return Response.json({
      enabled: !!(row?.totp_enabled),
      hasSecret: !!(row?.totp_secret),
    });
  } finally {
    sqlite.close();
  }
}

// POST /api/settings/totp — start TOTP setup: generate secret + QR code
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id ?? "0");
  const email = session.user.email ?? "";

  const secret = generateTOTPSecret();
  const uri = getTOTPUri(secret, email);
  const qrCodeDataUrl = await QRCode.toDataURL(uri, { width: 200, margin: 2 });

  const sqlite = new Database(dbPath);
  try {
    // Store pending secret (not yet enabled)
    sqlite
      .prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?")
      .run(secret, userId);
    return Response.json({ qrCodeDataUrl, manualKey: secret, uri });
  } finally {
    sqlite.close();
  }
}

// PUT /api/settings/totp — verify code and enable TOTP
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id ?? "0");

  try {
    const { code } = await req.json() as { code?: string };
    if (!code) return Response.json({ error: "Código requerido" }, { status: 400 });

    const sqlite = new Database(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT totp_secret FROM users WHERE id = ?")
        .get(userId) as { totp_secret: string | null } | undefined;

      if (!row?.totp_secret) {
        return Response.json({ error: "Iniciá la configuración primero" }, { status: 400 });
      }

      if (!verifyTOTPCode(row.totp_secret, code)) {
        return Response.json({ error: "Código incorrecto. Verificá que la hora de tu teléfono sea correcta." }, { status: 422 });
      }

      sqlite.prepare("UPDATE users SET totp_enabled = 1 WHERE id = ?").run(userId);
      return Response.json({ success: true });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ error: "Error al activar 2FA" }, { status: 500 });
  }
}

// DELETE /api/settings/totp — disable TOTP (requires current code)
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = parseInt(session.user.id ?? "0");

  try {
    const { code } = await req.json() as { code?: string };
    if (!code) return Response.json({ error: "Ingresá tu código actual para desactivar 2FA" }, { status: 400 });

    const sqlite = new Database(dbPath);
    try {
      const row = sqlite
        .prepare("SELECT totp_secret, totp_enabled FROM users WHERE id = ?")
        .get(userId) as { totp_secret: string | null; totp_enabled: number } | undefined;

      if (!row?.totp_enabled || !row?.totp_secret) {
        return Response.json({ error: "2FA no está activado" }, { status: 400 });
      }

      if (!verifyTOTPCode(row.totp_secret, code)) {
        return Response.json({ error: "Código incorrecto" }, { status: 422 });
      }

      sqlite.prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?").run(userId);
      return Response.json({ success: true });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ error: "Error al desactivar 2FA" }, { status: 500 });
  }
}
