import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");

// POST /api/auth/totp-check
// Returns whether a user account requires TOTP for login.
// Does NOT verify password — only checks totp_enabled flag.
export async function POST(req: Request) {
  try {
    const { email: rawEmail } = await req.json() as { email?: string };
    if (!rawEmail) return Response.json({ required: false });
    const email = rawEmail.trim().toLowerCase();

    const sqlite = new Database(dbPath);
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("busy_timeout = 5000");
    try {
      const row = sqlite
        .prepare("SELECT totp_enabled FROM users WHERE LOWER(email) = ? AND is_active = 1 LIMIT 1")
        .get(email) as { totp_enabled: number } | undefined;
      return Response.json({ required: !!(row?.totp_enabled) });
    } finally {
      sqlite.close();
    }
  } catch {
    return Response.json({ required: false });
  }
}
