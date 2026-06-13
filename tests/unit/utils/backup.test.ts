import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyBackupPlan, createLocalBackupSnapshot, downloadJsonFile } from '@/lib/utils/backup';
import { db } from '@/lib/db/schema';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import { resetTestDb } from '@/tests/helpers/db';
import type { AuditEvent, BillItemCostAllocation, CashMovement, Expense, InventoryLot, StockMovement, SyncQueueItem } from '@/types/domain';

describe('local backup utilities', () => {
  beforeEach(async () => {
    await resetTestDb();
  });

  it('creates a complete local snapshot including operational cash, expense, audit, sync, and settings tables', async () => {
    const product = makeProduct({ id: 'product-backup', barcode: '7290000000301' });
    const movement: StockMovement = {
      id: 'movement-backup',
      productId: product.id,
      movementType: 'initial',
      quantityChange: 4,
      referenceType: 'product',
      referenceId: product.id,
      createdAt: '2026-01-01T01:00:00.000Z',
      syncStatus: 'pending',
    };
    const cashMovement: CashMovement = {
      id: 'cash-backup',
      type: 'cash_in',
      amount: 50,
      reason: 'Opening float top-up',
      createdAt: '2026-01-01T02:00:00.000Z',
      syncStatus: 'pending',
    };
    const expense: Expense = {
      id: 'expense-backup',
      category: 'utilities',
      amount: 12.5,
      paymentMethod: 'cash',
      payee: 'Electricity',
      expenseDate: '2026-01-01',
      createdAt: '2026-01-01T03:00:00.000Z',
      syncStatus: 'pending',
    };
    const auditEvent: AuditEvent = {
      id: 'audit-backup',
      category: 'expense',
      action: 'expense_create',
      entityId: expense.id,
      entityLabel: 'Electricity',
      createdAt: '2026-01-01T03:00:01.000Z',
      syncStatus: 'pending',
    };
    const syncJob: SyncQueueItem = {
      id: 'sync-backup',
      entity: 'expense',
      entityId: expense.id,
      operation: 'create',
      status: 'pending',
      retryCount: 0,
      createdAt: '2026-01-01T03:00:02.000Z',
      updatedAt: '2026-01-01T03:00:02.000Z',
    };
    const inventoryLot: InventoryLot = {
      id: 'lot-backup',
      productId: product.id,
      sourceType: 'opening_balance',
      sourceId: 'import-opening',
      sourceLabel: 'Imported opening stock',
      receivedAt: '2026-01-01T00:30:00.000Z',
      quantityReceived: 4,
      quantityRemaining: 4,
      unitCost: 3,
      status: 'open',
      createdAt: '2026-01-01T00:30:00.000Z',
      updatedAt: '2026-01-01T00:30:00.000Z',
      syncStatus: 'pending',
    };
    const costAllocation: BillItemCostAllocation = {
      id: 'alloc-backup',
      billId: 'bill-backup',
      billItemId: 'bill-item-backup',
      productId: product.id,
      inventoryLotId: inventoryLot.id,
      quantity: 1,
      quantityReturned: 0,
      unitCost: 3,
      lineCost: 3,
      createdAt: '2026-01-01T04:00:00.000Z',
      updatedAt: '2026-01-01T04:00:00.000Z',
      syncStatus: 'pending',
    };

    await db.products.put(product);
    await db.stockMovements.put(movement);
    await db.settings.put(makeSettings({ id: 'app-settings', currency: 'ILS' }));
    await db.cashMovements.put(cashMovement);
    await db.expenses.put(expense);
    await db.auditEvents.put(auditEvent);
    await db.syncQueue.put(syncJob);
    await db.inventoryLots.put(inventoryLot);
    await db.billItemCostAllocations.put(costAllocation);

    const snapshot = await createLocalBackupSnapshot();

    expect(snapshot.version).toBe(1);
    expect(snapshot.app).toBe('shopkeeper-pos');
    expect(snapshot.counts).toMatchObject({
      products: 1,
      stockMovements: 1,
      settings: 1,
      cashMovements: 1,
      expenses: 1,
      auditEvents: 1,
      syncQueue: 1,
      inventoryLots: 1,
      billItemCostAllocations: 1,
    });
    expect(snapshot.data.products).toEqual([product]);
    expect(snapshot.data.stockMovements).toEqual([movement]);
    expect(snapshot.data.cashMovements).toEqual([cashMovement]);
    expect(snapshot.data.expenses).toEqual([expense]);
    expect(snapshot.data.auditEvents).toEqual([auditEvent]);
    expect(snapshot.data.syncQueue).toEqual([syncJob]);
    expect(snapshot.data.inventoryLots).toEqual([inventoryLot]);
    expect(snapshot.data.billItemCostAllocations).toEqual([costAllocation]);
  });

  it('creates an empty backup plan with every count and table initialized', () => {
    const plan = createEmptyBackupPlan();

    expect(plan.counts).toEqual({
      products: 0,
      bills: 0,
      billItems: 0,
      stockMovements: 0,
      customerPayments: 0,
      customers: 0,
      shifts: 0,
      suppliers: 0,
      purchases: 0,
      purchaseItems: 0,
      supplierPayments: 0,
      auditEvents: 0,
      cashMovements: 0,
      expenses: 0,
      inventoryLots: 0,
      billItemCostAllocations: 0,
      settings: 0,
      syncQueue: 0,
      syncConflicts: 0,
    });
    expect(plan.data.auditEvents).toEqual([]);
    expect(plan.data.cashMovements).toEqual([]);
    expect(plan.data.expenses).toEqual([]);
    expect(plan.data.inventoryLots).toEqual([]);
    expect(plan.data.billItemCostAllocations).toEqual([]);
  });

  it('downloads backup JSON using a temporary object URL and removes the temporary link', () => {
    const click = vi.fn();
    const createObjectURL = vi.fn((_obj: Blob | MediaSource) => 'blob:backup-url');
    const revokeObjectURL = vi.fn();
    const originalCreateElement = document.createElement.bind(document);

    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn() });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'a') {
        Object.defineProperty(element, 'click', { value: click });
      }
      return element;
    }) as typeof document.createElement);

    downloadJsonFile('backup.json', { ok: true });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="backup.json"]')).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:backup-url');
  });
});
