import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { normalizeCustomerKey as sharedNormalizeCustomerKey } from '@/lib/utils/customer-key';
import type { Bill, CustomerPayment } from '@/types/domain';

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

function netBillTotal(bill: Bill): number {
  return Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0));
}

function updateRowFromBill(row: CustomerLedgerRow, bill: Bill): CustomerLedgerRow {
  const netTotal = netBillTotal(bill);
  const paidOnBill = Math.min(Math.max(0, bill.paidAmount || 0), netTotal);
  return {
    ...row,
    name: bill.customerName?.trim() || row.name,
    phone: bill.customerPhone?.trim() || row.phone,
    creditSales: row.creditSales + netTotal,
    paidOnBills: row.paidOnBills + paidOnBill,
    billCount: row.billCount + 1,
    lastActivityAt: bill.createdAt > row.lastActivityAt ? bill.createdAt : row.lastActivityAt,
  };
}

function updateRowFromPayment(row: CustomerLedgerRow, payment: CustomerPayment): CustomerLedgerRow {
  return {
    ...row,
    name: payment.customerName || row.name,
    phone: payment.customerPhone || row.phone,
    payments: row.payments + payment.amount,
    lastActivityAt: payment.createdAt > row.lastActivityAt ? payment.createdAt : row.lastActivityAt,
  };
}

function createEmptyRow(key: string, name = 'Unknown customer', phone?: string): CustomerLedgerRow {
  return {
    key,
    name,
    phone,
    creditSales: 0,
    paidOnBills: 0,
    payments: 0,
    balanceDue: 0,
    billCount: 0,
    lastActivityAt: '',
  };
}

export async function getCustomerLedger(): Promise<CustomerLedgerRow[]> {
  const [bills, payments] = await Promise.all([
    db.bills.where('paymentMethod').equals('credit').toArray(),
    db.customerPayments.toArray(),
  ]);

  const rows = new Map<string, CustomerLedgerRow>();

  for (const bill of bills) {
    if (bill.status === 'voided') continue;
    const key = normalizeCustomerKey({ name: bill.customerName, phone: bill.customerPhone });
    if (!key) continue;
    const row = rows.get(key) ?? createEmptyRow(key, bill.customerName || 'Credit customer', bill.customerPhone);
    rows.set(key, updateRowFromBill(row, bill));
  }

  for (const payment of payments) {
    const key = payment.customerKey;
    const row = rows.get(key) ?? createEmptyRow(key, payment.customerName, payment.customerPhone);
    rows.set(key, updateRowFromPayment(row, payment));
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      balanceDue: row.creditSales - row.paidOnBills - row.payments,
    }))
    .sort((a, b) => b.balanceDue - a.balanceDue || b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export async function getCustomerLedgerDetails(customerKey: string): Promise<CustomerLedgerDetails | null> {
  const [ledger, bills, payments] = await Promise.all([
    getCustomerLedger(),
    db.bills.where('paymentMethod').equals('credit').toArray(),
    db.customerPayments.where('customerKey').equals(customerKey).reverse().sortBy('createdAt'),
  ]);

  const row = ledger.find((item) => item.key === customerKey);
  if (!row) return null;

  const customerBills = bills
    .filter((bill) => bill.status !== 'voided')
    .filter((bill) => normalizeCustomerKey({ name: bill.customerName, phone: bill.customerPhone }) === customerKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { ...row, bills: customerBills, paymentRows: payments };
}

export async function recordCustomerPayment(input: {
  customerKey: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  note?: string;
}): Promise<CustomerPayment> {
  const amount = Number(input.amount);
  if (!input.customerKey) throw new Error('Customer is required.');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Payment amount must be greater than zero.');

  const now = nowIso();
  const payment: CustomerPayment = {
    id: createId('cust_pay'),
    customerKey: input.customerKey,
    customerName: input.customerName.trim() || 'Customer',
    customerPhone: input.customerPhone?.trim() || undefined,
    amount,
    note: input.note?.trim() || undefined,
    createdAt: now,
    syncStatus: 'pending',
  };

  await db.transaction('rw', [db.customerPayments, db.syncQueue], async () => {
    await db.customerPayments.add(payment);
    await db.syncQueue.put(buildSyncQueueItem({
      entity: 'customerPayment',
      entityId: payment.id,
      operation: 'create',
    }));
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }

  return payment;
}
