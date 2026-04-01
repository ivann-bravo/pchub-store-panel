import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { purchaseOrders, purchaseOrderItems, historicalMargins } from "@/lib/db/schema";
import { eq, and, gte, lte, sql, isNull } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

// GET /api/purchases/stats?year=2026&month=3&week=1
// week: 1-4 (optional, if omitted returns full month)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
  const year = parseInt(searchParams.get("year") || String(now.getFullYear()));
  const month = parseInt(searchParams.get("month") || String(now.getMonth() + 1));
  const week = searchParams.get("week") ? parseInt(searchParams.get("week")!) : null;

  // Date range for the selected period
  let startDate: string;
  let endDate: string;

  if (week != null) {
    // Week 1 = days 1-7, Week 2 = 8-14, Week 3 = 15-21, Week 4 = 22-end
    const weekStarts = [1, 8, 15, 22];
    const weekEnds = [7, 14, 21, 31];
    const dayStart = weekStarts[week - 1] ?? 1;
    const dayEnd = weekEnds[week - 1] ?? 31;
    startDate = `${year}-${String(month).padStart(2, "0")}-${String(dayStart).padStart(2, "0")}`;
    endDate = `${year}-${String(month).padStart(2, "0")}-${String(dayEnd).padStart(2, "0")} 23:59:59`;
  } else {
    startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    endDate = `${year}-${String(month).padStart(2, "0")}-31 23:59:59`;
  }

  // Get all closed orders in period
  const closedOrders = await db
    .select({
      id: purchaseOrders.id,
      totalPaid: purchaseOrders.totalPaid,
      closedAt: purchaseOrders.closedAt,
    })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.status, "closed"),
        gte(purchaseOrders.closedAt, startDate),
        lte(purchaseOrders.closedAt, endDate)
      )
    );

  // ── Historical margins for this period ──────────────────────────────────────
  // Fetched regardless of whether real orders exist — they're merged below.
  const historical = await db
    .select()
    .from(historicalMargins)
    .where(and(eq(historicalMargins.year, year), eq(historicalMargins.month, month)));

  // For a specific week view, also check for a week-specific historical entry
  const historicalWeekEntry = week != null
    ? historical.find((h) => h.week === week)
    : null;

  // For the month view: sum all historical week entries; if none exist, use the NULL-week entry
  const historicalWeekEntries = historical.filter((h) => h.week != null);
  const historicalMonthEntry = historical.find((h) => h.week == null);
  const historicalForMonth = historicalWeekEntries.length > 0
    ? historicalWeekEntries.reduce(
        (acc, h) => ({
          cashRevenue: acc.cashRevenue + h.cashRevenue,
          stockValue: acc.stockValue + h.stockValue,
          totalCost: acc.totalCost + h.totalCost,
          cashMargin: acc.cashMargin + h.cashMargin,
          orderCount: acc.orderCount + h.orderCount,
        }),
        { cashRevenue: 0, stockValue: 0, totalCost: 0, cashMargin: 0, orderCount: 0 }
      )
    : historicalMonthEntry
    ? { cashRevenue: historicalMonthEntry.cashRevenue, stockValue: historicalMonthEntry.stockValue, totalCost: historicalMonthEntry.totalCost, cashMargin: historicalMonthEntry.cashMargin, orderCount: historicalMonthEntry.orderCount }
    : null;

  if (closedOrders.length === 0 && !historicalForMonth && !historicalWeekEntry) {
    return NextResponse.json({
      cashRevenue: 0, stockValue: 0, totalCost: 0, cashMargin: 0, totalMargin: 0,
      orderCount: 0, hasHistorical: false, startDate, endDate,
    });
  }

  // ── Real purchase order data ─────────────────────────────────────────────────
  let cashRevenue = 0;
  let stockValue = 0;
  let itemAgg: Array<{ purchaseOrderId: number; goesToStock: boolean; cashRevenue: number; stockValue: number }> = [];

  if (closedOrders.length > 0) {
    const orderIds = closedOrders.map((o) => o.id);
    itemAgg = await db
      .select({
        purchaseOrderId: purchaseOrderItems.purchaseOrderId,
        goesToStock: purchaseOrderItems.goesToStock,
        cashRevenue: sql<number>`SUM(COALESCE(client_paid_amount, 0))`,
        stockValue: sql<number>`SUM(COALESCE(unit_cost_ars, 0) * quantity)`,
      })
      .from(purchaseOrderItems)
      .where(sql`${purchaseOrderItems.purchaseOrderId} IN (${sql.join(orderIds.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(purchaseOrderItems.purchaseOrderId, purchaseOrderItems.goesToStock);

    for (const row of itemAgg) {
      if (!row.goesToStock) cashRevenue += row.cashRevenue ?? 0;
      else stockValue += row.stockValue ?? 0;
    }
  }

  const totalCost = closedOrders.reduce((s, o) => s + (o.totalPaid ?? 0), 0);

  // ── Merge historical into real totals ────────────────────────────────────────
  // Historical entries store cashMargin directly (we may not have raw revenue/cost breakdown).
  // Use stored cashMargin rather than recomputing from cashRevenue - totalCost.
  const hSource = week != null ? historicalWeekEntry : historicalForMonth;
  const mergedCashRevenue = cashRevenue + (hSource?.cashRevenue ?? 0);
  const mergedStockValue = stockValue + (hSource?.stockValue ?? 0);
  const mergedTotalCost = totalCost + (hSource?.totalCost ?? 0);
  const mergedCashMargin = (cashRevenue - totalCost) + (hSource?.cashMargin ?? 0);
  const mergedTotalMargin = mergedCashMargin + mergedStockValue;
  const mergedOrderCount = closedOrders.length + (hSource?.orderCount ?? 0);
  const hasHistorical = hSource != null;

  // ── Weekly breakdown (month view only) ───────────────────────────────────────
  let weeklyBreakdown = null;
  if (!week) {
    weeklyBreakdown = [1, 2, 3, 4].map((w) => {
      const weekStarts = [1, 8, 15, 22];
      const weekEnds = [7, 14, 21, 31];
      const ds = `${year}-${String(month).padStart(2, "0")}-${String(weekStarts[w - 1]).padStart(2, "0")}`;
      const de = `${year}-${String(month).padStart(2, "0")}-${String(weekEnds[w - 1]).padStart(2, "0")} 23:59:59`;
      const weekOrders = closedOrders.filter((o) => o.closedAt && o.closedAt >= ds && o.closedAt <= de);
      const weekIds = new Set(weekOrders.map((o) => o.id));
      const weekItems = itemAgg.filter((i) => weekIds.has(i.purchaseOrderId));
      let wCash = 0, wStock = 0;
      for (const row of weekItems) {
        if (!row.goesToStock) wCash += row.cashRevenue ?? 0;
        else wStock += row.stockValue ?? 0;
      }
      const wCost = weekOrders.reduce((s, o) => s + (o.totalPaid ?? 0), 0);

      // Merge historical week data
      const hWeek = historicalWeekEntries.find((h) => h.week === w);
      const isHistorical = hWeek != null && weekOrders.length === 0;

      return {
        week: w,
        cashRevenue: wCash + (hWeek?.cashRevenue ?? 0),
        stockValue: wStock + (hWeek?.stockValue ?? 0),
        cost: wCost + (hWeek?.totalCost ?? 0),
        cashMargin: (wCash - wCost) + (hWeek?.cashMargin ?? 0),
        totalMargin: (wCash - wCost + wStock) + (hWeek?.totalMargin ?? 0),
        orderCount: weekOrders.length + (hWeek?.orderCount ?? 0),
        isHistorical, // true = data came entirely from historical records
      };
    });

    // If no weekly records exist in historical but there is a monthly-only entry,
    // show the monthly total in week 1 for display purposes and mark the rest empty.
    if (historicalWeekEntries.length === 0 && historicalMonthEntry && closedOrders.length === 0) {
      weeklyBreakdown = weeklyBreakdown.map((w, i) =>
        i === 0
          ? { ...w, cashRevenue: historicalMonthEntry.cashRevenue, stockValue: historicalMonthEntry.stockValue,
              cost: historicalMonthEntry.totalCost, cashMargin: historicalMonthEntry.cashMargin,
              totalMargin: historicalMonthEntry.totalMargin, orderCount: historicalMonthEntry.orderCount,
              isHistorical: true, isMonthlyOnly: true }
          : { ...w, isHistorical: true, isMonthlyOnly: true }
      );
    }
  }

  void isNull; // imported but only used via SQL template literals

  return NextResponse.json({
    cashRevenue: mergedCashRevenue,
    stockValue: mergedStockValue,
    totalCost: mergedTotalCost,
    cashMargin: mergedCashMargin,
    totalMargin: mergedTotalMargin,
    orderCount: mergedOrderCount,
    hasHistorical,
    startDate, endDate, weeklyBreakdown,
  });
}
