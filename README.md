# PCHub Store Panel

A full-featured B2B admin panel for hardware price management, built with Next.js 14, SQLite, and Drizzle ORM.

---

## Live Demo

> [pchub-store-panel.vercel.app](https://pchub-store-panel.vercel.app)

| Field    | Value               |
|----------|---------------------|
| Email    | `admin@pchub.com.ar` |
| Password | `demo123`           |

> **Note:** Vercel cold starts reset all data to the seed state — this is intentional for a public demo.

---

## Tech Stack

| Layer         | Technology                              |
|---------------|----------------------------------------|
| Framework     | Next.js 14 (App Router, TypeScript)    |
| Database      | SQLite via `better-sqlite3` + Drizzle ORM |
| Auth          | NextAuth v4 — JWT 8h, bcryptjs, TOTP  |
| UI            | Tailwind CSS + shadcn/ui               |
| PDF           | `@react-pdf/renderer`                  |
| AI            | Gemini Flash (description generation)  |
| Deploy        | Vercel (serverless) — /tmp SQLite pattern |

---

## Features

- **Multi-supplier price comparison** — link products to up to N suppliers, auto-calculate best ARS cost
- **WooCommerce sync** — push prices, stock, attributes to a WC store via REST API (demo: blocked with toast)
- **Quote builder** — create PDF quotes with line items, IVA breakdown, client info
- **Purchase orders** — track supplier orders and received items
- **Combo builder** — define PC build templates with slot-based product matching
- **Offer detection** — automatic price drop detection and promotional pricing
- **Exchange rate tracking** — live ARS/USD rate via dolarapi.com (demo: hardcoded 1200/1250)
- **Supplier catalog import** — CSV/Excel import with fuzzy product matching
- **AI description generation** — Gemini Flash for product short/long descriptions (demo: blocked)
- **Image processing** — WebP conversion, white background detection, WC upload (demo: blocked)
- **2FA / TOTP** — optional per-user authenticator app support
- **Role-based access** — SUPER_ADMIN / VIEWER roles

---

## Architecture Note — SQLite on Vercel

Vercel serverless functions have a read-only filesystem except `/tmp`. This project uses a pre-seeded `data/demo-seed.db` bundled into the Lambda via `outputFileTracingIncludes`. On the first cold start, the file is copied to `/tmp/pchub-demo.db` and used for the session. Subsequent cold starts reset to the seed state — no persistent writes.

```
next build → bundles data/demo-seed.db
cold start → fs.copyFileSync("data/demo-seed.db", "/tmp/pchub-demo.db")
requests   → read/write /tmp/pchub-demo.db
cold start → reset (copy again from bundle)
```

---

## Local Development

```bash
git clone https://github.com/ivann-bravo/pchub-store-panel.git
cd pchub-store-panel
npm install
cp .env.example .env.local
# Edit .env.local — set NEXTAUTH_SECRET to any random string
npm run dev
```

Login with `admin@pchub.com.ar` / `demo123`.

To rebuild the demo seed database:

```bash
npx tsx scripts/build-demo-seed.ts
```

---

## Contact

Built by **Avanzio** — [@ivann-bravo](https://github.com/ivann-bravo)
