# PCHub Store Panel Panel — Architecture Reference

> Last updated: 2026-02-26

## Overview

B2B admin panel for comparing hardware prices across multiple suppliers in Argentina. Handles USD↔ARS conversion, multi-supplier procurement, complex tax rules, and automated pricing/offer detection.

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js App Router | 14.2.35 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS + shadcn/ui (Radix) | 3.4.1 |
| Database | SQLite via better-sqlite3 | 12.6.2 |
| ORM | Drizzle ORM | 0.45.1 |
| Forms | React Hook Form + Zod | 7.71 / 3.x |
| Charts | Recharts | — |
| Notifications | Sonner | — |
| Excel/CSV | XLSX (SheetJS) | 0.18.5 |
| Icons | Lucide React | — |
| Theming | next-themes | — |

---

## Directory Structure

```
/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # 43 API route handlers
│   │   ├── products/           # Product pages
│   │   ├── suppliers/          # Supplier pages + supplier-specific UIs
│   │   ├── pricing/            # Pricing, exchange rates, alerts
│   │   ├── combos/             # Combo builder + Buscador
│   │   ├── settings/           # App config
│   │   ├── layout.tsx          # Root layout (sidebar, theme, toasts)
│   │   └── page.tsx            # Dashboard
│   ├── components/
│   │   ├── ui/                 # 20+ shadcn/ui components
│   │   └── layout/             # Sidebar, header, main content
│   ├── lib/
│   │   ├── db/                 # Schema, migrations, seed
│   │   ├── connectors/         # 13 supplier connectors
│   │   ├── pricing-engine.ts   # Markup, offer detection
│   │   ├── combo-resolver.ts   # Slot resolution with CTE queries
│   │   ├── sync.ts             # Exchange rate & supplier sync
│   │   ├── matching.ts         # Jaccard-based catalog matching
│   │   ├── import-parser.ts    # CSV/Excel parsing
│   │   ├── pricing.ts          # Cost calculation formulas
│   │   ├── exchange-rate.ts    # dolarapi.com fetch + cache
│   │   ├── number-format.ts    # ARS formatting, Argentine number parsing
│   │   └── utils.ts            # General utilities (clsx)
│   └── types/
│       └── index.ts            # Shared TypeScript interfaces
├── scripts/                    # One-off migration/seed scripts
├── public/                     # Static assets (logo.svg, isotipo.svg)
├── data/                       # SQLite database (auto-created, gitignored)
├── docs/                       # This documentation
├── drizzle.config.ts
├── next.config.mjs
├── tailwind.config.ts
└── package.json
```

---

## Database Schema (15 Tables)

### Core Tables

#### `suppliers`
Supplier configuration and API credentials.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| code | text | Unique code (AIR, ASHIR, HDC...) |
| name | text | Display name |
| currency | text | ARS \| USD |
| taxRate | real | Shipping surcharge rate |
| shippingSurcharge | real | Fixed shipping surcharge |
| shippingPercent | real | % shipping surcharge |
| isActive | integer | Boolean flag |
| columnMapping | text | JSON — CSV column name mappings |
| connectorType | text | manual \| api |
| apiConfig | text | JSON — API credentials (stored plaintext ⚠️) |
| autoSync | integer | Boolean — enable background sync |
| stockConfig | text | JSON — stock quantity thresholds |
| notes | text | Free-form notes |
| createdAt / updatedAt | text | ISO timestamps |

#### `products`
Products for sale (mirrors WooCommerce catalog).

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| woocommerceId | integer | WooCommerce product ID |
| name | text | |
| sku | text | Internal SKU (PCTRY#### for combos) |
| eanUpc | text | Barcode |
| category / brand | text | |
| warranty | text | |
| ivaRate | real | IVA % (0.21 or 0.105) |
| internalTaxRate | real | Internal tax % |
| markupRegular / markupOffer | real | Price multipliers |
| offerStart / offerEnd | text | ISO dates |
| ownPriceRegular / ownPriceOffer | real | Manual price override |
| ownCostUsd | real | Manual cost override in USD |
| localStock | integer | Own warehouse stock |
| hasSupplierStock | integer | Boolean — any supplier has stock |
| weightKg, lengthCm, widthCm, heightCm | real | Shipping dimensions |
| imageUrl / slug / storeUrl | text | WooCommerce fields |
| productTags | text | Comma-separated |
| attributes | text | JSON — structured attributes (RAM type, etc.) |
| createdAt / updatedAt | text | ISO timestamps |

#### `productSupplierLinks`
Many-to-many: product ↔ supplier, with stock info.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| productId | integer FK → products | |
| supplierId | integer FK → suppliers | |
| supplierCode | text | Supplier's own product code |
| supplierStockQty | integer | Last known stock quantity |
| stockLocked | integer | Manual override (Sentey) |
| isActive | integer | Boolean |
| createdAt | text | |

**Indexes:** `UNIQUE(productId, supplierId)`, `idx(supplierId, isActive, supplierCode)`

#### `supplierPrices`
Latest price per link (1:1 with productSupplierLinks).

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| linkId | integer FK → productSupplierLinks | |
| rawPrice | real | Supplier's price (before taxes) |
| currency | text | ARS \| USD |
| exchangeRate | real | Rate used for calculation |
| finalCostArs | real | Pre-calculated cost in ARS |
| updatedAt | text | |

#### `supplierCatalogs`
Import batch metadata.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| supplierId | integer FK | |
| filename | text | Original uploaded filename |
| rowCount | integer | Total rows parsed |
| linkedCount | integer | Rows matched to products |
| importedAt | text | |
| status | text | pending \| processing \| completed \| failed |

#### `supplierCatalogItems`
Unlinked catalog rows awaiting matching.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| catalogId | integer FK | |
| supplierCode | text | |
| description | text | |
| price | real | |
| currency | text | |
| stockAvailable | integer | |
| rawData | text | JSON — full original row |
| linkedProductId | integer | Set when matched |
| matchConfidence | real | 0-1 confidence score |
| createdAt | text | |

#### `exchangeRates`
Historical USD/ARS exchange rate snapshots.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| source | text | dolarapi \| manual |
| buyRate | real | |
| sellRate | real | |
| fetchedAt | text | Indexed |

#### `settings`
Key-value store for app configuration.

| Key | Value | Notes |
|-----|-------|-------|
| global_markup | number | e.g. 1.10 |
| offer_mode | "normal" \| "event" | |
| offer_global_start | ISO date | |
| offer_global_end | ISO date | |
| exchange_rate_override | number \| null | Manual USD/ARS override |

#### `priceHistory`
Historical supplier price tracking (time-series).

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| linkId | integer FK | |
| rawPrice, currency, exchangeRate, finalCostArs | — | Snapshot |
| recordedAt | text | **Index:** (linkId, recordedAt) |

#### `productPriceHistory`
Historical product price tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| productId | integer FK | |
| priceRegular, priceOffer | real | |
| recordedAt | text | **Index:** (productId, recordedAt) |

#### `dismissedMatches`
Dismissed catalog item matches (don't suggest again).

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| supplierId / supplierCode | — | |
| dismissType | text | match \| create |
| createdAt | text | |

**Index:** `UNIQUE(supplierId, supplierCode, dismissType)`

### Combo Builder Tables

#### `comboTemplates`
PC combo configurations.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| name | text | |
| sku | text UNIQUE | Format: PCTRY#### |
| productId | integer FK → products | Linked product |
| isActive | integer | |
| lastTotalPrice | real | Cached resolved price |
| lastHasStock | integer | Cached stock status |
| lastRefreshedAt | text | |
| notes / createdAt / updatedAt | text | |

#### `comboSlots`
Individual slots in a combo.

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| templateId | integer FK | |
| slotName | text | e.g. "CPU", "RAM" |
| sortOrder | integer | |
| slotType | text | auto \| fixed \| combo |
| quantity | integer | |
| fixedProductId | integer | For fixed slots |
| fixedComboId | integer | For nested combos |
| filterCategory | text | For auto slots |
| filterMustKeywords | text | JSON — AND keywords |
| filterKeywords | text | JSON — OR keywords |
| filterAttributes | text | JSON — attribute filters |
| resolvedProductId | integer | Cached resolution |
| resolvedPrice | real | Cached price |
| resolvedAt | text | |

**Index:** `idx(templateId)`

#### `buscadorItems`
Searchable component database (36 pre-populated items).

| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| groupName | text | e.g. "Motherboard" |
| label | text | Display label |
| filterCategory, filterMustKeywords, filterKeywords, filterAttributes | — | Same as comboSlots |
| filterMinPrice / filterMaxPrice | real | Price range |
| sortOrder | integer | |
| resolvedProductId, resolvedProductName, resolvedPrice, resolvedHasStock, resolvedAt | — | Cached resolution |

#### `wooExportSnapshots`
Tracks last WooCommerce export state for delta exports.

| Column | Type | Notes |
|--------|------|-------|
| productId | integer PK | |
| woocommerceId | integer | |
| stockQty, stockStatus, postStatus | — | |
| regularPrice, salePrice | real | |
| offerStart, offerEnd | text | |
| exportedAt | text | |

---

## API Routes (43 endpoints)

### Products

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/products` | List with filters: category, brand, supplier, stock, search, sort, pagination |
| POST | `/api/products` | Create product |
| GET | `/api/products/[id]` | Get single product |
| PUT | `/api/products/[id]` | Update product |
| PATCH | `/api/products/bulk` | Bulk upsert |
| GET | `/api/products/categories` | Distinct categories |
| GET | `/api/products/filters` | Available filter options |
| GET | `/api/products/export-csv` | WooCommerce CSV export (delta or full) |

### Suppliers

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/suppliers` | List with stats (productCount, priceCount, lastImport) |
| GET | `/api/suppliers/[id]` | Get supplier detail |
| PUT | `/api/suppliers/[id]` | Update supplier config |
| DELETE | `/api/suppliers/[id]` | Delete supplier |
| GET | `/api/suppliers/[id]/sync` | Manual API sync |
| POST | `/api/suppliers/[id]/import` | Upload CSV/Excel (generic) |
| GET | `/api/suppliers/[id]/catalog` | Unlinked catalog items (paginated) |
| POST | `/api/suppliers/[id]/catalog/match` | Find matches for unlinked items |
| POST | `/api/suppliers/[id]/catalog/bulk-link` | Link items to products |
| POST | `/api/suppliers/[id]/catalog/dismiss` | Dismiss a match suggestion |

### Supplier-Specific Import Routes

| Method | Route | Supplier |
|--------|-------|----------|
| POST | `/api/suppliers/air/import` | Air (CSV) |
| POST | `/api/suppliers/ashir/import` | Ashir (Excel) |
| POST | `/api/suppliers/hdc/import` | HDC (Excel) |
| POST | `/api/suppliers/invid/import` | Invid (Excel) |
| POST | `/api/suppliers/latamly/import` | Latamly (CSV) |
| POST | `/api/suppliers/polytech/import` | Polytech (Excel) |
| POST | `/api/suppliers/polytech/sync` | Polytech (API real-time) |
| POST | `/api/suppliers/sentey/import` | Sentey (Excel) |
| POST | `/api/suppliers/sentey/stock` | Sentey manual stock override |

### Pricing

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/pricing/settings` | Read/write global markup, offer mode, dates |
| POST | `/api/pricing/apply-markup` | Apply global markup to all products |
| POST | `/api/pricing/run-offers` | Auto-detect offers by category average |
| GET | `/api/exchange-rate` | Get latest USD/ARS rate |
| POST | `/api/exchange-rate` | Refresh from dolarapi.com or use override |
| GET | `/api/prices/recalculate` | Recalculate all supplier prices |

### Combos

| Method | Route | Description |
|--------|-------|-------------|
| GET/POST | `/api/combos` | List / create combo templates |
| GET/PUT/DELETE | `/api/combos/[id]` | CRUD on single combo |
| POST | `/api/combos/[id]/refresh` | Resolve slots for one combo |
| POST | `/api/combos/refresh-all` | Batch refresh all combos |
| POST | `/api/combos/auto-link-by-sku` | Auto-link products by PCTRY SKU prefix |
| POST | `/api/combos/bulk-create-from-products` | Create combos from product selection |
| POST | `/api/combos/detect-pctry` | Find potential PCTRY products |

### Buscador

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/buscador` | List all items with resolved products |
| GET/PUT | `/api/buscador/[id]` | Get/update single item |
| POST | `/api/buscador/refresh` | Refresh all resolutions |

### Analytics & Misc

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/stats` | Dashboard stats |
| GET | `/api/price-alerts` | Price changes in last 24h per product |
| GET | `/api/stale-stock` | Products without stock for >2 months |
| GET | `/api/auto-sync` | Background sync status |
| POST | `/api/auto-sync/[id]` | Trigger manual sync |
| GET/PUT | `/api/settings` | App configuration |
| GET | `/api/debug/buscador` | Debug endpoint (remove before deploy ⚠️) |

---

## Supplier Connectors (13 Total)

### File-Based Connectors (CSV/Excel)

| Code | Format | Key Fields | Notes |
|------|--------|-----------|-------|
| AIR | CSV | LUG stock, IVA, regional stock (ROS/MZA/CBA) | 10.5% internal tax for monitors |
| ASHIR | Excel | COD. INTERNO, PART NUMBER, DISTRI S/IVA, ESTADO | ESTADO → stock quantity mapping |
| HDC | Excel | Marca, Codigo, Precio, IVA, Últimas unidades | defaultStockQty: 10 |
| INVID | Excel | Codigo, Precio sin IVA, %IVA, Imp. Int., Observaciones | "Stock Bajo" detection |
| LATAMLY | CSV | — | |
| POLYTECH | Excel + API | Gestion Resellers REST API | Basic auth, real-time sync |
| SENTEY | Excel (no header) | Columns by index: [3]=SKU, [4]=Desc, [5]=Price, [6]=IVA | stockLocked for manual control |

### API Connectors

| Code | Auth | Notes |
|------|------|-------|
| GN (Grupo Nucleo) | Bearer token | Full catalog fetch |
| NB (New Bytes) | Bearer token | Full catalog fetch |
| ELIT | Bearer token | Rate-limited (300ms between pages) |
| PCARTS (PC Arts) | Bearer token | 30s timeout (AbortController) |

### Connector Interface

```typescript
interface SupplierConnector {
  fetchCatalog(): Promise<CatalogItem[]>;
  testConnection(): Promise<boolean>;
  getExchangeRate?(): Promise<number>;
}
```

---

## Business Logic

### Pricing Formula

```
finalCostArs = rawPrice × (1 + ivaRate + taxRate + internalTaxRate) × exchangeRate
clientPrice  = finalCostArs × markupRegular  (or ownPriceRegular if set)
```

**Rounding:** Prices round to 9-ending:
- $1234 → $1239
- $1245 → $1249
- $1250 → $1259

### Offer Detection Logic

1. Group all products by category
2. Calculate category average price
3. Products below average by 5-40%+ → auto-set as offer
4. Apply `offerGlobalStart` / `offerGlobalEnd` dates

### Combo Resolution Flow

1. Each auto slot has: `filterCategory`, `filterMustKeywords` (AND), `filterKeywords` (OR), `filterAttributes` (JSON), price range
2. CTE query finds cheapest matching product per slot with best supplier price
3. Slot resolved → price cached, stock checked
4. Total combo price = sum of all slot prices × slot quantities
5. `lastHasStock = true` only if all auto slots have stock

### Import Flow

```
1. Upload CSV/Excel
2. Parse with XLSX library → normalize rows
3. Create supplierCatalog record (status: processing)
4. For each row:
   a. Find existing productSupplierLink by supplierCode
   b. Update or insert supplierPrice
   c. Record priceHistory snapshot
   d. Update product.hasSupplierStock
5. Zero out stale stock (items not in current import)
6. Update catalog status → completed
7. Run post-import hooks (offer detection, combo refresh)
```

### Exchange Rate

- Source: `dolarapi.com` (Dólar Blue)
- Cache: 15-minute staleness threshold
- Override: `settings.exchange_rate_override` takes precedence

---

## Database Performance Config

```sql
PRAGMA journal_mode = WAL;      -- Concurrent reads
PRAGMA cache_size = -32000;     -- 32MB page cache
PRAGMA foreign_keys = ON;
```

**16 performance indexes** defined on:
- `productSupplierLinks(supplierId, isActive, supplierCode)`
- `supplierPrices(linkId)`
- `priceHistory(linkId, recordedAt)`
- `productPriceHistory(productId, recordedAt)`
- `supplierCatalogItems(catalogId, linkedProductId)`
- `dismissedMatches(supplierId, supplierCode, dismissType)` (UNIQUE)
- `exchangeRates(fetchedAt)`
- `products(category, brand, hasSupplierStock)` (composite)
- And more...

---

## Environment Configuration

No environment variables required for development. All supplier API credentials are stored in the database via the UI.

**For production, add:**
```
# Required for auth (when implemented)
AUTH_SECRET=...

# Optional: override database path
DATABASE_PATH=/var/data/pchub-demo.db
```

**Runtime settings (in `settings` table):**

| Key | Default | Description |
|-----|---------|-------------|
| `global_markup` | 1.10 | Price multiplier for all products |
| `offer_mode` | "normal" | "normal" or "event" |
| `offer_global_start` | — | ISO date for event offer start |
| `offer_global_end` | — | ISO date for event offer end |
| `exchange_rate_override` | null | Manual USD/ARS rate |

---

## Scripts

| File | Purpose |
|------|---------|
| `scripts/seed-combos.js` | Pre-populate combo templates |
| `scripts/migrate-buscador-attributes.js` | Add attribute filtering to buscador items |
| `scripts/migrate-slot-attributes.js` | Add attribute filtering to combo slots |
| `scripts/import-woocommerce-attributes.js` | Parse WooCommerce attributes into JSON |
| `scripts/setup-ram-buscador.js` | Configure RAM buscador with DDR4/DDR5 variants |
| `scripts/sync-combo-stock.cjs` | Standalone periodic combo stock refresh |
