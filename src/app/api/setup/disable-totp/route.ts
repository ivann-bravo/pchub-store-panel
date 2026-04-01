import { db } from "@/lib/db";
import type { DB } from "@/lib/db";

// POST /api/setup/disable-totp
// Emergency endpoint to disable TOTP for a user — requires SETUP_SECRET env var.
// Use only when locked out. Protected by secret, no auth session required.
export async function POST(req: Request) {
  const setupSecret = process.env.SETUP_SECRET;
  if (!setupSecret) {
    return Response.json({ error: "SETUP_SECRET not configured" }, { status: 500 });
  }

  try {
    const { email, secret } = await req.json() as { email?: string; secret?: string };

    if (!secret || secret !== setupSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!email) {
      return Response.json({ error: "email required" }, { status: 400 });
    }

    // Access $client to trigger lazy DB init (creates tables if needed)
    const sqlite = (db as DB).$client;
    const result = sqlite
      .prepare("UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE LOWER(email) = LOWER(?)")
      .run(email.trim().toLowerCase());

    if (result.changes === 0) {
      return Response.json({ error: "User not found" }, { status: 404 });
    }

    return Response.json({ success: true, message: `TOTP disabled for ${email.trim().toLowerCase()}` });
  } catch (err) {
    console.error("[disable-totp]", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
