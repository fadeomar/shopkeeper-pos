import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { makePurchaseDraftItem, makePurchaseForm } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { createFinalizedPurchase, voidPurchase } = await import('@/lib/services/purchase-service');
const { getSupplierLedger, getSupplierLedgerDetails, recordSupplierPayment } = await import(
  '@/lib/services/supplier-ledger-service'
);

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('supplier-ledger-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings();
  });

  it('rolls credit purchases and supplier payments into the canonical supplier balance', async () => {
    const product = await seedProduct({ quantityInStock: 3, buyPrice: 6, sellPrice: 10 });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 3, unitCost: 6 })],
      form: makePurchaseForm({
        paymentMethod: 'credit',
        paidAmount: 4,
        supplierName: 'Main Supplier',
        supplierPhone: '+970 599-333-444',
      }),
    });
    const supplier = await db.suppliers.get(purchase.purchase.supplierId!);

    const payment = await recordSupplierPayment({
      supplierKey: supplier!.id,
      supplierName: 'Main Supplier',
      supplierPhone: '+970 599-333-444',
      amount: 6,
      note: 'Debt settlement',
    });

    const ledger = await getSupplierLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: supplier!.id,
      name: 'Main Supplier',
      phone: '+970 599-333-444',
      totalPurchases: 18,
      creditPurchases: 14,
      paidOnPurchases: 4,
      payments: 6,
      balanceOwed: 8,
      purchaseCount: 1,
    });

    const details = await getSupplierLedgerDetails(supplier!.id);
    expect(details?.purchases.map((row) => row.id)).toEqual([purchase.purchase.id]);
    expect(details?.paymentRows.map((row) => row.id)).toEqual([payment.id]);
    await expect(db.syncQueue.get(getSyncQueueId('supplierPayment', payment.id))).resolves.toMatchObject({
      entity: 'supplierPayment',
      operation: 'create',
      status: 'pending',
    });
  });

  it('allows supplier overpayment and exposes it as a negative owed balance', async () => {
    const product = await seedProduct({ quantityInStock: 0, buyPrice: 5, sellPrice: 8 });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 2, unitCost: 5 })],
      form: makePurchaseForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        supplierName: 'Refund Supplier',
        supplierPhone: '0599222333',
      }),
    });

    await recordSupplierPayment({
      supplierKey: purchase.purchase.supplierId!,
      supplierName: 'Refund Supplier',
      amount: 12,
      paymentMethod: 'bank',
    });

    const [row] = await getSupplierLedger();
    expect(row).toMatchObject({
      creditPurchases: 10,
      payments: 12,
      balanceOwed: -2,
    });
  });

  it('ignores voided purchases in totals but keeps explicit payments visible', async () => {
    const product = await seedProduct({ quantityInStock: 0, buyPrice: 4, sellPrice: 8 });
    const purchase = await createFinalizedPurchase({
      items: [makePurchaseDraftItem(product, { quantity: 2, unitCost: 4 })],
      form: makePurchaseForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        supplierName: 'Void Supplier',
        supplierPhone: '0599111222',
      }),
    });
    const supplierId = purchase.purchase.supplierId!;

    await recordSupplierPayment({ supplierKey: supplierId, supplierName: 'Void Supplier', amount: 5 });
    await voidPurchase({ purchaseId: purchase.purchase.id, reason: 'Duplicate purchase' });

    const row = (await getSupplierLedger()).find((item) => item.key === supplierId);
    expect(row).toMatchObject({
      totalPurchases: 0,
      creditPurchases: 0,
      paidOnPurchases: 0,
      payments: 5,
      balanceOwed: -5,
      purchaseCount: 0,
    });
    const details = await getSupplierLedgerDetails(supplierId);
    expect(details?.purchases).toEqual([]);
    expect(details?.paymentRows).toHaveLength(1);
  });

  it('validates supplier payments before writing rows', async () => {
    await expectAppError(
      recordSupplierPayment({ supplierKey: '', supplierName: 'No key', amount: 5 }),
      AppErrorCode.SUPPLIER_REQUIRED,
    );
    await expectAppError(
      recordSupplierPayment({ supplierKey: 'supp-1', supplierName: 'Bad amount', amount: -1 }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );

    await expect(db.supplierPayments.count()).resolves.toBe(0);
    await expect(db.syncQueue.count()).resolves.toBe(0);
  });
});
