import { AppError, AppErrorCode } from "@/lib/errors/app-error";
import { db } from "@/lib/db/schema";
import { SETTINGS_ID } from "@/lib/db/repositories";
import { nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import { buildSyncQueueItem } from "@/lib/services/sync-queue-service";
import { logAudit } from "@/lib/services/audit-service";
import { normalizeCustomerKey as sharedNormalizeCustomerKey } from "@/lib/utils/customer-key";
import { netSplitField, normalizeBillSplit } from "@/lib/utils/bill-split";
import type { Bill, Customer, CustomerPayment } from "@/types/domain";
import { assertSubscriptionCanWrite } from '@/lib/services/subscription-service';

export interface CustomerLedgerRow {
  key: string;
  name: string;
  phone?: string;
  creditSales: number;
  paidOnBills: number;
  payments: number;
  balanceDue: number;
  billCount: number;
  lastActivityAt: string;
}

export interface CustomerLedgerDetails extends CustomerLedgerRow {
  bills: Bill[];
  paymentRows: CustomerPayment[];
}

// Re-exported from the shared util so existing call sites keep working.
export const normalizeCustomerKey = sharedNormalizeCustomerKey;

/**
 * Build the legacy → customerId mapping for the current Customer table.
 *
 * Bills authored before the v7 migration carry a phone/name snapshot but no
 * customerId; CustomerPayment rows still use the legacy customerKey too.
 * This mapping lets every ledger reader resolve those legacy keys to the
 * unified Customer.id at query time without rewriting the underlying rows.
 */
function buildLegacyKeyToCustomerId(
  customers: Customer[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const customer of customers) {
    const key = normalizeCustomerKey({
      name: customer.name,
      phone: customer.phone,
    });
    if (key) map.set(key, customer.id);
  }
  return map;
}

/**
 * Resolve a bill to its canonical ledger key. Prefer bill.customerId (set
 * by createFinalizedBill or the v7 migration). Fall back to the legacy
 * normalized key if the bill predates the customer table and no matching
 * Customer row exists yet.
 */
function canonicalBillKey(
  bill: Bill,
  legacyToCustomerId: Map<string, string>,
): string {
  if (bill.customerId) return bill.customerId;
  const legacy = normalizeCustomerKey({
    name: bill.customerName,
    phone: bill.customerPhone,
  });
  if (!legacy) return "";
  return legacyToCustomerId.get(legacy) ?? legacy;
}

function canonicalPaymentKey(
  payment: CustomerPayment,
  legacyToCustomerId: Map<string, string>,
): string {
  // New payments authored after Bβ6 will store the customerId directly. Old
  // payments stored a `phone:...` or `name:...` legacy key — resolve those
  // through the mapping when possible so they line up with their bills.
  return legacyToCustomerId.get(payment.customerKey) ?? payment.customerKey;
}

function updateRowFromBill(
  row: CustomerLedgerRow,
  bill: Bill,
): CustomerLedgerRow {
  const withSplit = normalizeBillSplit(bill) as Bill;
  // Net credit (after returns) is the bill's contribution to outstanding debt.
  // Net paid (cash + card, after returns) is what the customer already paid
  // at sale time.
  const netCredit = netSplitField(withSplit, withSplit.creditAmount);
  const netPaid =
    netSplitField(withSplit, withSplit.cashAmount) +
    netSplitField(withSplit, withSplit.cardAmount);
  return {
    ...row,
    name: bill.customerName?.trim() || row.name,
    phone: bill.customerPhone?.trim() || row.phone,
    creditSales: row.creditSales + netCredit + netPaid,
    paidOnBills: row.paidOnBills + netPaid,
    billCount: row.billCount + 1,
    lastActivityAt:
      bill.createdAt > row.lastActivityAt ? bill.createdAt : row.lastActivityAt,
  };
}

function updateRowFromPayment(
  row: CustomerLedgerRow,
  payment: CustomerPayment,
): CustomerLedgerRow {
  return {
    ...row,
    name: payment.customerName || row.name,
    phone: payment.customerPhone || row.phone,
    payments: row.payments + payment.amount,
    lastActivityAt:
      payment.createdAt > row.lastActivityAt
        ? payment.createdAt
        : row.lastActivityAt,
  };
}

function createEmptyRow(
  key: string,
  name = "Unknown customer",
  phone?: string,
): CustomerLedgerRow {
  return {
    key,
    name,
    phone,
    creditSales: 0,
    paidOnBills: 0,
    payments: 0,
    balanceDue: 0,
    billCount: 0,
    lastActivityAt: "",
  };
}

function buildCustomerLedger(
  bills: Bill[],
  payments: CustomerPayment[],
  customers: Customer[],
): CustomerLedgerRow[] {
  const legacyToCustomerId = buildLegacyKeyToCustomerId(customers);
  const customersById = new Map(customers.map((c) => [c.id, c]));
  const rows = new Map<string, CustomerLedgerRow>();

  for (const customer of customers) {
    rows.set(customer.id, {
      key: customer.id,
      name: customer.name,
      phone: customer.phone,
      creditSales: 0,
      paidOnBills: 0,
      payments: 0,
      balanceDue: 0,
      billCount: 0,
      lastActivityAt: customer.updatedAt || customer.createdAt || "",
    });
  }

  for (const bill of bills) {
    if (bill.status === "voided") continue;
    const key = canonicalBillKey(bill, legacyToCustomerId);
    if (!key) continue;
    const customer = customersById.get(key);
    const row =
      rows.get(key) ??
      createEmptyRow(
        key,
        customer?.name || bill.customerName || "Credit customer",
        customer?.phone || bill.customerPhone,
      );
    rows.set(key, updateRowFromBill(row, bill));
  }

  for (const payment of payments) {
    const key = canonicalPaymentKey(payment, legacyToCustomerId);
    const customer = customersById.get(key);
    const row =
      rows.get(key) ??
      createEmptyRow(
        key,
        customer?.name || payment.customerName,
        customer?.phone || payment.customerPhone,
      );
    rows.set(key, updateRowFromPayment(row, payment));
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      balanceDue: row.creditSales - row.paidOnBills - row.payments,
    }))
    .sort(
      (a, b) =>
        b.balanceDue - a.balanceDue ||
        b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
}

export async function getCustomerLedger(): Promise<CustomerLedgerRow[]> {
  const [bills, payments, customers] = await Promise.all([
    db.bills
      .toArray()
      .then((all) => all.filter((b) => (b.creditAmount ?? 0) > 0)),
    db.customerPayments.toArray(),
    db.customers.toArray(),
  ]);
  return buildCustomerLedger(bills, payments, customers);
}

export async function getCustomerLedgerDetails(
  customerKey: string,
): Promise<CustomerLedgerDetails | null> {
  const [bills, payments, customers] = await Promise.all([
    db.bills
      .toArray()
      .then((all) => all.filter((b) => (b.creditAmount ?? 0) > 0)),
    db.customerPayments.toArray(),
    db.customers.toArray(),
  ]);

  const ledger = buildCustomerLedger(bills, payments, customers);
  const row = ledger.find((item) => item.key === customerKey);
  if (!row) return null;

  const legacyToCustomerId = buildLegacyKeyToCustomerId(customers);

  const customerBills = bills
    .filter((bill) => bill.status !== "voided")
    .filter(
      (bill) => canonicalBillKey(bill, legacyToCustomerId) === customerKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const customerPayments = payments
    .filter(
      (payment) =>
        canonicalPaymentKey(payment, legacyToCustomerId) === customerKey,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { ...row, bills: customerBills, paymentRows: customerPayments };
}

export async function recordCustomerPayment(input: {
  customerKey: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  note?: string;
  paymentMethod?: CustomerPayment["paymentMethod"];
  shiftId?: string;
}): Promise<CustomerPayment> {
  await assertSubscriptionCanWrite();
  const amount = Number(input.amount);
  if (!input.customerKey) throw new AppError(AppErrorCode.CUSTOMER_REQUIRED);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new AppError(AppErrorCode.PAYMENT_AMOUNT_INVALID);

  const now = nowIso();
  const paymentMethod = input.paymentMethod ?? "cash";
  const [settings, shift] = await Promise.all([
    db.settings.get(SETTINGS_ID),
    input.shiftId
      ? db.shifts.get(input.shiftId)
      : db.shifts.where("status").equals("open").first(),
  ]);
  if (input.shiftId && shift?.status === "closed") {
    throw new AppError(AppErrorCode.CLOSED_SHIFT_RECORD_LOCKED);
  }
  const resolvedShiftId = shift?.status === "open" ? shift.id : undefined;
  if (settings?.requireShift && paymentMethod === "cash" && !resolvedShiftId) {
    throw new AppError(AppErrorCode.SHIFT_REQUIRED_FOR_CASH_ACTION);
  }

  const payment: CustomerPayment = {
    id: createId("cust_pay"),
    customerKey: input.customerKey,
    customerName: input.customerName.trim() || "Customer",
    customerPhone: input.customerPhone?.trim() || undefined,
    amount,
    note: input.note?.trim() || undefined,
    paymentMethod,
    shiftId: resolvedShiftId,
    createdAt: now,
    syncStatus: "pending",
  };

  await db.transaction("rw", [db.customerPayments, db.syncQueue], async () => {
    await db.customerPayments.add(payment);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: "customerPayment",
        entityId: payment.id,
        operation: "create",
      }),
    );
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("shopkeeper:sync-requested"));
  }

  void logAudit({
    category: "customer",
    action: "payment",
    entityId: input.customerKey,
    entityLabel: payment.customerName,
    summary: `${amount} (${payment.paymentMethod})`,
    reason: payment.note,
    shiftId: payment.shiftId,
  });

  return payment;
}
