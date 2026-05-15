import { db } from '@/lib/db/schema';
import { nowIso } from '@/lib/utils/date';
import { createId } from '@/lib/utils/id';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { normalizeSupplierKey } from '@/lib/utils/supplier-key';
import { netSplitField, normalizeBillSplit } from '@/lib/utils/bill-split';
import type { Purchase, Supplier, SupplierPayment, Bill } from '@/types/domain';

/**
 * Buy-side ledger row, mirror of CustomerLedgerRow.
 *
 *   creditPurchases — sum of creditAmount across this supplier's purchases
 *                     (gross, net of returns). This is what we owe AT THE
 *                     TIME OF PURCHASE before any payments.
 *   paidOnPurchases — cash + card paid up-front on each purchase (net of
 *                     returns).
 *   payments        — subsequent SupplierPayment rows (debt settlement).
 *   balanceOwed     — creditPurchases − payments. Positive means we owe;
 *                     negative means the supplier owes us (we overpaid /
 *                     they owe a refund).
 */
export interface SupplierLedgerRow {
  key: string;
  name: string;
  phone?: string;
  totalPurchases: number;     // gross net-of-return cost across all purchases
  creditPurchases: number;    // net unpaid portion at sale time (sum of creditAmount net of returns)
  paidOnPurchases: number;    // up-front cash+card paid at purchase (net of returns)
  payments: number;           // debt-settlement payments after purchase
  balanceOwed: number;        // = creditPurchases − payments
  purchaseCount: number;
  lastActivityAt: string;
}

export interface SupplierLedgerDetails extends SupplierLedgerRow {
  purchases: Purchase[];
  paymentRows: SupplierPayment[];
}

function buildLegacyKeyToSupplierId(suppliers: Supplier[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const supplier of suppliers) {
    const key = normalizeSupplierKey({ name: supplier.name, phone: supplier.phone });
    if (key) map.set(key, supplier.id);
  }
  return map;
}

function canonicalPurchaseKey(purchase: Purchase, legacyToSupplierId: Map<string, string>): string {
  if (purchase.supplierId) return purchase.supplierId;
  const legacy = normalizeSupplierKey({ name: purchase.supplierName, phone: purchase.supplierPhone });
  if (!legacy) return '';
  return legacyToSupplierId.get(legacy) ?? legacy;
}

function canonicalPaymentKey(payment: SupplierPayment, legacyToSupplierId: Map<string, string>): string {
  return legacyToSupplierId.get(payment.supplierKey) ?? payment.supplierKey;
}

function createEmptyRow(key: string, name = 'Unknown supplier', phone?: string): SupplierLedgerRow {
  return {
    key,
    name,
    phone,
    totalPurchases: 0,
    creditPurchases: 0,
    paidOnPurchases: 0,
    payments: 0,
    balanceOwed: 0,
    purchaseCount: 0,
    lastActivityAt: '',
  };
}

function updateRowFromPurchase(row: SupplierLedgerRow, purchase: Purchase): SupplierLedgerRow {
  // Purchases share the bill-split shape, so the existing helpers apply.
  // We just rename "credit" semantically — for purchases, credit means
  // "owed to supplier" rather than "owed by customer".
  const withSplit = normalizeBillSplit(purchase as unknown as Bill) as unknown as Purchase;
  const netCredit = netSplitField(withSplit as unknown as Bill, withSplit.creditAmount);
  const netCashAtPurchase = netSplitField(withSplit as unknown as Bill, withSplit.cashAmount);
  const netCardAtPurchase = netSplitField(withSplit as unknown as Bill, withSplit.cardAmount);
  const netPaid = netCashAtPurchase + netCardAtPurchase;
  return {
    ...row,
    name: purchase.supplierName?.trim() || row.name,
    phone: purchase.supplierPhone?.trim() || row.phone,
    totalPurchases: row.totalPurchases + netCredit + netPaid,
    creditPurchases: row.creditPurchases + netCredit,
    paidOnPurchases: row.paidOnPurchases + netPaid,
    purchaseCount: row.purchaseCount + 1,
    lastActivityAt: purchase.createdAt > row.lastActivityAt ? purchase.createdAt : row.lastActivityAt,
  };
}

function updateRowFromPayment(row: SupplierLedgerRow, payment: SupplierPayment): SupplierLedgerRow {
  return {
    ...row,
    name: payment.supplierName || row.name,
    phone: payment.supplierPhone || row.phone,
    payments: row.payments + payment.amount,
    lastActivityAt: payment.createdAt > row.lastActivityAt ? payment.createdAt : row.lastActivityAt,
  };
}

/**
 * List every supplier with their running balance. Suppliers that exist in the
 * directory but have no activity yet still appear (with zero balances and an
 * empty lastActivityAt) — symmetric with the customer ledger so the user can
 * always see who they have on file even before the first purchase.
 */
export async function getSupplierLedger(): Promise<SupplierLedgerRow[]> {
  const [purchases, payments, suppliers] = await Promise.all([
    db.purchases.toArray(),
    db.supplierPayments.toArray(),
    db.suppliers.toArray(),
  ]);

  const legacyToSupplierId = buildLegacyKeyToSupplierId(suppliers);
  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
  const rows = new Map<string, SupplierLedgerRow>();

  // Seed every known supplier so they appear even with zero activity.
  for (const supplier of suppliers) {
    rows.set(
      supplier.id,
      createEmptyRow(supplier.id, supplier.name, supplier.phone),
    );
  }

  for (const purchase of purchases) {
    if (purchase.status === 'voided') continue;
    const key = canonicalPurchaseKey(purchase, legacyToSupplierId);
    if (!key) continue;
    const supplier = suppliersById.get(key);
    const row = rows.get(key) ?? createEmptyRow(
      key,
      supplier?.name || purchase.supplierName || 'Unknown supplier',
      supplier?.phone || purchase.supplierPhone,
    );
    rows.set(key, updateRowFromPurchase(row, purchase));
  }

  for (const payment of payments) {
    const key = canonicalPaymentKey(payment, legacyToSupplierId);
    const supplier = suppliersById.get(key);
    const row = rows.get(key) ?? createEmptyRow(
      key,
      supplier?.name || payment.supplierName,
      supplier?.phone || payment.supplierPhone,
    );
    rows.set(key, updateRowFromPayment(row, payment));
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      balanceOwed: row.creditPurchases - row.payments,
    }))
    .sort(
      (a, b) =>
        b.balanceOwed - a.balanceOwed ||
        b.lastActivityAt.localeCompare(a.lastActivityAt) ||
        a.name.localeCompare(b.name),
    );
}

export async function getSupplierLedgerDetails(
  supplierKey: string,
): Promise<SupplierLedgerDetails | null> {
  const [ledger, purchases, payments, suppliers] = await Promise.all([
    getSupplierLedger(),
    db.purchases.toArray(),
    db.supplierPayments.toArray(),
    db.suppliers.toArray(),
  ]);

  const row = ledger.find((item) => item.key === supplierKey);
  if (!row) return null;

  const legacyToSupplierId = buildLegacyKeyToSupplierId(suppliers);

  const supplierPurchases = purchases
    .filter((purchase) => purchase.status !== 'voided')
    .filter((purchase) => canonicalPurchaseKey(purchase, legacyToSupplierId) === supplierKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const supplierPaymentRows = payments
    .filter((payment) => canonicalPaymentKey(payment, legacyToSupplierId) === supplierKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return { ...row, purchases: supplierPurchases, paymentRows: supplierPaymentRows };
}

/**
 * Record a payment we made to a supplier against their debt — mirror of
 * recordCustomerPayment with two important differences:
 *
 * 1. shiftId is set automatically when a shift is open on this device, so
 *    the cash leaves the drawer for end-of-shift reconciliation.
 * 2. Overpayment is allowed but the UI surface (supplier ledger workspace)
 *    nudges the cashier with a confirmation banner.
 */
export async function recordSupplierPayment(input: {
  supplierKey: string;
  supplierName: string;
  supplierPhone?: string;
  amount: number;
  note?: string;
}): Promise<SupplierPayment> {
  const amount = Number(input.amount);
  if (!input.supplierKey) throw new Error('Supplier is required.');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const now = nowIso();
  const activeShift = await db.shifts.where('status').equals('open').first();

  const payment: SupplierPayment = {
    id: createId('supp_pay'),
    supplierKey: input.supplierKey,
    supplierName: input.supplierName.trim() || 'Supplier',
    supplierPhone: input.supplierPhone?.trim() || undefined,
    amount,
    note: input.note?.trim() || undefined,
    createdAt: now,
    shiftId: activeShift?.id,
    syncStatus: 'pending',
  };

  await db.transaction('rw', [db.supplierPayments, db.syncQueue], async () => {
    await db.supplierPayments.add(payment);
    await db.syncQueue.put(
      buildSyncQueueItem({
        entity: 'supplierPayment',
        entityId: payment.id,
        operation: 'create',
      }),
    );
  });

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }

  return payment;
}
