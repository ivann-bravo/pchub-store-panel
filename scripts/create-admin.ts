import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";

// Parse CLI args: --email, --password, --name
function getArg(name: string): string | undefined {
  const flag = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(flag));
  return arg ? arg.slice(flag.length) : undefined;
}

const email = getArg("email");
const password = getArg("password");
const name = getArg("name") ?? "Admin";
const role = getArg("role") ?? "SUPER_ADMIN";

if (!email || !password) {
  console.error("Uso: npm run create-admin -- --email=admin@example.com --password=secret --name=Admin");
  process.exit(1);
}

if (!["SUPER_ADMIN", "VIEWER"].includes(role)) {
  console.error("Rol inválido. Usar: SUPER_ADMIN | VIEWER");
  process.exit(1);
}

const dbPath = path.join(process.cwd(), "data", "pchub-demo.db");
const sqlite = new Database(dbPath);

// Ensure users table exists
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'VIEWER' CHECK(role IN ('SUPER_ADMIN', 'VIEWER')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

const passwordHash = bcrypt.hashSync(password, 12);

const existing = sqlite.prepare("SELECT id FROM users WHERE LOWER(email) = LOWER(?)").get(email);

if (existing) {
  sqlite
    .prepare(
      "UPDATE users SET password_hash = ?, name = ?, role = ?, is_active = 1, updated_at = datetime('now') WHERE LOWER(email) = LOWER(?)"
    )
    .run(passwordHash, name, role, email);
  console.log(`Usuario actualizado: ${email} (${role})`);
} else {
  sqlite
    .prepare(
      "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)"
    )
    .run(email, passwordHash, name, role);
  console.log(`Usuario creado: ${email} (${role})`);
}

sqlite.close();
