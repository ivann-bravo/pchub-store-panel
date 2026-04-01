# Purchase Orders System — Design Document
**Date:** 2026-03-20
**Status:** Approved, ready to implement

---

## Problem

The team currently manages supplier purchase orders in a Word document + calculator. This makes it slow to track margins, manage stock purchases, and communicate orders to suppliers.

---

## Solution Overview

A purchase order management system inside the admin panel. Orders are organized per supplier, accumulate items from WooCommerce orders or manual entry, and can be exported as formatted text to send to the supplier via WhatsApp.

---

## Data Model

### `purchaseOrders` table
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| supplierId | integer FK | references suppliers |
| status | text | `open` or `closed` |
| supplierOrderNumber | text | filled when closing |
| totalPaid | real | filled when closing |
| notes | text | optional |
| createdAt | text | |
| closedAt | text | nullable |

### `purchaseOrderItems` table
| Column | Type | Notes |
|--------|------|-------|
| id | integer PK | |
| purchaseOrderId | integer FK | |
| productId | integer FK | references products |
| supplierId | integer FK | which supplier this item is assigned to |
| supplierCode | text | snapshot of supplier's internal code at time of adding |
| quantity | integer | |
| unitCostArs | real | snapshot of finalCostArs at time of adding |
| clientPaidAmount | real | nullable — what client paid for this item (from WC order) |
| wcOrderId | integer | nullable — WC order ID (reference only, not FK) |
| wcOrderRef | text | nullable — WC order number for display |
| goesToStock | boolean | true if item goes to local stock |
| stockEntryPrice | real | nullable — price to enter in local stock |
| notes | text | nullable — e.g. "also available at GN for $X" |
| createdAt | text | |

---

## Margin Calculation (per closed order)

```
Revenue (cash)  = SUM(clientPaidAmount) for items where goesToStock = false
Stock value     = SUM(unitCostArs × quantity) for items where goesToStock = true
Cost            = totalPaid (what we paid the supplier)
Cash margin     = Revenue - Cost  (can be negative if buying for stock)
Total margin    = Cash margin + Stock value
```

### Weekly / Monthly Dashboard
- **Ingreso en plata**: sum of clientPaidAmount across closed orders in period
- **Ingreso en stock**: sum of (unitCostArs × qty) for stock items in period
- **Egreso a proveedores**: sum of totalPaid across closed orders in period
- **Margen cash**: Ingreso en plata − Egreso
- **Margen total**: Margen cash + Ingreso en stock

---

## Pages

### `/purchases` — Main dashboard
- Weekly/monthly stat cards: ingreso plata, ingreso stock, egreso, margen cash, margen total
- Week selector (semana 1–4 of current month) + month selector
- One card per supplier with open orders, showing item count and estimated total
- Button to add items (from WC or manual)

### `/purchases/[id]` — Purchase order detail
- Header: supplier name, status badge, estimated total, created date
- Items table: product name, supplier code, qty, unit cost, estimated total, WC order ref, goes-to-stock badge
- For each item: shows assigned supplier (cheapest) + "También en X a $Y" badge if alternatives exist
- "Agregar ítem" button (manual entry)
- "Copiar lista" button — copies WhatsApp-ready formatted text
- "Cerrar compra" button (opens dialog) — enter supplier order number, total paid, and for stock items: stock entry price

### Export format (WhatsApp copy)
```
Compra Ashir — Total estimado: $285.000
━━━━━━━━━━━━━━━━━━━━━━━━━━
2x Procesador Intel Core i5-12400
   COD. ASH-1234
1x Memoria RAM Kingston 16GB DDR5
   COD. ASH-5678
━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## WooCommerce Order Import

- Pulls orders from WC API with status = `processing` only
- Shows order number, customer name, date, and line items
- Each line item shows: product name, qty, unit price paid, and whether the product is in the panel (matched by woocommerceId)
- User selects which items to add to purchase list
- System auto-assigns each item to the open order of the cheapest supplier with stock
- If no open order exists for that supplier, creates one automatically
- If multiple suppliers have the item, shows alternatives in item notes

---

## Flows

### Add from WooCommerce
1. Click "Importar desde WC" on `/purchases`
2. System fetches recent `processing` orders via WC API
3. User sees list of orders with their items
4. Selects items to purchase → system assigns to cheapest supplier's open order
5. Redirects to the relevant purchase order(s)

### Add manually
1. Click "Agregar ítem" on a purchase order detail page
2. Search product by name/SKU
3. Set quantity, whether it goes to stock or is for a client, and if for client: client paid amount
4. Item is added to that order

### Close a purchase
1. Click "Cerrar compra" on order detail
2. Dialog: enter supplier order number + total paid
3. For each item marked as goesToStock: enter stock entry price
4. Confirm → order status changes to `closed`, local stock updated for stock items, margin calculated

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/purchases` | List orders (open/closed, by supplier, by period) |
| POST | `/api/purchases` | Create new purchase order |
| GET | `/api/purchases/[id]` | Get order with items |
| PATCH | `/api/purchases/[id]` | Update order (close, add supplier order #) |
| POST | `/api/purchases/[id]/items` | Add item to order |
| DELETE | `/api/purchases/[id]/items/[itemId]` | Remove item |
| GET | `/api/purchases/stats` | Weekly/monthly margin stats |
| GET | `/api/woocommerce/orders` | Fetch processing orders from WC API |

---

## Implementation Order

1. DB schema — new tables + migration
2. API routes — CRUD for orders and items + WC orders fetch
3. `/purchases` page — dashboard with open orders per supplier
4. `/purchases/[id]` page — order detail, add items, export, close dialog
5. WC order import flow — modal to select items from WC orders
6. Stats dashboard — weekly/monthly margin cards
