import type { Bill, BillItem, PaymentMethod } from "@/types/domain";

export type BillDateFilter =
  | "all"
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "custom";
export type PaymentFilter = "all" | PaymentMethod;

export interface BillFilters {
  query: string;
  dateFilter: BillDateFilter;
  paymentFilter: PaymentFilter;
  customFrom: string;
  customTo: string;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDateRange(filter: BillFilters): { from?: Date; to?: Date } {
  const today = startOfDay(new Date());

  if (filter.dateFilter === "today")
    return { from: today, to: addDays(today, 1) };
  if (filter.dateFilter === "yesterday")
    return { from: addDays(today, -1), to: today };
  if (filter.dateFilter === "week")
    return { from: addDays(today, -6), to: addDays(today, 1) };
  if (filter.dateFilter === "month") {
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: monthStart, to: addDays(today, 1) };
  }
  if (filter.dateFilter === "custom") {
    return {
      from: filter.customFrom
        ? startOfDay(new Date(filter.customFrom))
        : undefined,
      to: filter.customTo
        ? addDays(startOfDay(new Date(filter.customTo)), 1)
        : undefined,
    };
  }

  return {};
}

export function filterBills(bills: Bill[], filters: BillFilters) {
  const query = filters.query.trim().toLowerCase();
  const { from, to } = getDateRange(filters);

  return bills.filter((bill) => {
    if (
      filters.paymentFilter !== "all" &&
      bill.paymentMethod !== filters.paymentFilter
    )
      return false;

    const created = new Date(bill.createdAt);
    if (from && created < from) return false;
    if (to && created >= to) return false;

    if (!query) return true;
    return [
      bill.billNumber,
      bill.customerName,
      bill.customerPhone,
      bill.cashierName,
      bill.paymentMethod,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
}

export function getBillNetTotal(bill: Bill): number {
  if (bill.status === "voided") return 0;
  return Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0));
}

export function getBillNetProfit(bill: Bill): number {
  if (bill.status === "voided") return 0;
  return bill.totalProfit - (bill.returnedProfit ?? 0);
}

export function getBillReturnedItemCount(items: BillItem[]): number {
  return items.reduce((sum, item) => sum + (item.quantityReturned ?? 0), 0);
}

export function summarizeBills(bills: Bill[]) {
  return bills.reduce(
    (summary, bill) => {
      summary.billCount += 1;
      summary.itemCount += bill.itemCount;
      const netTotal = getBillNetTotal(bill);
      const netProfit = getBillNetProfit(bill);
      summary.totalSales += netTotal;
      summary.totalProfit += netProfit;
      summary.totalPaid +=
        bill.status === "voided"
          ? 0
          : Math.max(0, bill.paidAmount - (bill.returnedAmount ?? 0));
      summary.byPayment[bill.paymentMethod] += netTotal;
      return summary;
    },
    {
      billCount: 0,
      itemCount: 0,
      totalSales: 0,
      totalProfit: 0,
      totalPaid: 0,
      byPayment: { cash: 0, card: 0, mixed: 0, credit: 0 } as Record<
        PaymentMethod,
        number
      >,
    },
  );
}
