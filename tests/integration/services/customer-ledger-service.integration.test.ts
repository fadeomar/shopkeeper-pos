import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { makeBillDraftItem, makeBillForm } from '@/tests/helpers/builders';
import { resetTestDb, seedProduct, seedSettings } from '@/tests/helpers/db';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/services/permission-service', () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
  getCurrentPermissions: vi.fn().mockResolvedValue({
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: true,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  }),
}));

vi.mock('@/lib/services/audit-service', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { createFinalizedBill, voidBill } = await import('@/lib/services/billing-service');
const { getCustomerLedger, getCustomerLedgerDetails, recordCustomerPayment } = await import(
  '@/lib/services/customer-ledger-service'
);

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('customer-ledger-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
    await seedSettings();
  });

  it('rolls credit bills and customer payments into the canonical customer balance', async () => {
    const product = await seedProduct({ quantityInStock: 10, sellPrice: 10 });
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 2, unitSellPrice: 10 })],
      form: makeBillForm({
        paymentMethod: 'credit',
        paidAmount: 5,
        customerName: 'Ali Market',
        customerPhone: '+970 599-111-222',
      }),
    });
    const customer = await db.customers.get(sale.bill.customerId!);

    const payment = await recordCustomerPayment({
      customerKey: customer!.id,
      customerName: 'Ali Market',
      customerPhone: '+970 599-111-222',
      amount: 7,
      note: 'Partial settlement',
    });

    const ledger = await getCustomerLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: customer!.id,
      name: 'Ali Market',
      phone: '+970 599-111-222',
      creditSales: 20,
      paidOnBills: 5,
      payments: 7,
      balanceDue: 8,
      billCount: 1,
    });

    const details = await getCustomerLedgerDetails(customer!.id);
    expect(details?.bills.map((bill) => bill.id)).toEqual([sale.bill.id]);
    expect(details?.paymentRows.map((row) => row.id)).toEqual([payment.id]);
    await expect(db.syncQueue.get(getSyncQueueId('customerPayment', payment.id))).resolves.toMatchObject({
      entity: 'customerPayment',
      operation: 'create',
      status: 'pending',
    });
  });

  it('resolves legacy phone/name payment keys to the matching customer id', async () => {
    const product = await seedProduct({ quantityInStock: 5, sellPrice: 12 });
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 12 })],
      form: makeBillForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        customerName: 'Legacy Customer',
        customerPhone: '+970 599-444-555',
      }),
    });

    await recordCustomerPayment({
      customerKey: 'phone:970599444555',
      customerName: 'Legacy Customer',
      customerPhone: '0599444555',
      amount: 2,
      paymentMethod: 'card',
    });

    const ledger = await getCustomerLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      key: sale.bill.customerId,
      creditSales: 12,
      paidOnBills: 0,
      payments: 2,
      balanceDue: 10,
    });
  });

  it('ignores voided credit bills while keeping explicit customer payments visible', async () => {
    const product = await seedProduct({ quantityInStock: 5, sellPrice: 9 });
    const sale = await createFinalizedBill({
      items: [makeBillDraftItem(product, { quantity: 1, unitSellPrice: 9 })],
      form: makeBillForm({
        paymentMethod: 'credit',
        paidAmount: 0,
        customerName: 'Void Customer',
        customerPhone: '0599000000',
      }),
    });
    const customerId = sale.bill.customerId!;

    await recordCustomerPayment({
      customerKey: customerId,
      customerName: 'Void Customer',
      amount: 3,
    });
    await voidBill({ billId: sale.bill.id, reason: 'Duplicate credit bill' });

    const row = (await getCustomerLedger()).find((item) => item.key === customerId);
    expect(row).toMatchObject({
      creditSales: 0,
      paidOnBills: 0,
      payments: 3,
      balanceDue: -3,
      billCount: 0,
    });
    const details = await getCustomerLedgerDetails(customerId);
    expect(details?.bills).toEqual([]);
    expect(details?.paymentRows).toHaveLength(1);
  });

  it('validates customer payments before writing rows', async () => {
    await expectAppError(
      recordCustomerPayment({ customerKey: '', customerName: 'No key', amount: 5 }),
      AppErrorCode.CUSTOMER_REQUIRED,
    );
    await expectAppError(
      recordCustomerPayment({ customerKey: 'cust-1', customerName: 'Bad amount', amount: 0 }),
      AppErrorCode.PAYMENT_AMOUNT_INVALID,
    );

    await expect(db.customerPayments.count()).resolves.toBe(0);
    await expect(db.syncQueue.count()).resolves.toBe(0);
  });
});
