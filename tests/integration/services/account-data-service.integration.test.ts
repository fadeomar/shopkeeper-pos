import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/schema';
import {
  getActiveUid,
  getLocalDataSummary,
  prepareRuntimeDbForUid,
  restoreAccountSnapshot,
  saveCurrentAccountSnapshot,
  setActiveUid,
} from '@/lib/services/account-data-service';
import { makeProduct, makeSettings } from '@/tests/helpers/builders';
import { resetTestDb } from '@/tests/helpers/db';
import type { AuditEvent, CashMovement, Expense, SyncQueueItem } from '@/types/domain';

const VAULT_DB_NAME = 'shopkeeper-pos-account-vault';

async function seedOperationalTables(label = 'seed'): Promise<void> {
  const product = makeProduct({ id: `product-${label}`, barcode: `72900000004${label.length}1`, name: `Product ${label}` });
  const cashMovement: CashMovement = {
    id: `cash-${label}`,
    type: 'cash_in',
    amount: 20,
    reason: `Cash ${label}`,
    createdAt: '2026-01-01T01:00:00.000Z',
    syncStatus: 'pending',
  };
  const expense: Expense = {
    id: `expense-${label}`,
    category: 'rent',
    amount: 15,
    paymentMethod: 'cash',
    createdAt: '2026-01-01T02:00:00.000Z',
    syncStatus: 'pending',
  };
  const auditEvent: AuditEvent = {
    id: `audit-${label}`,
    category: 'cash',
    action: 'cash_in',
    createdAt: '2026-01-01T03:00:00.000Z',
    syncStatus: 'pending',
  };
  const syncJob: SyncQueueItem = {
    id: `sync-${label}`,
    entity: 'product',
    entityId: product.id,
    operation: 'create',
    status: 'pending',
    retryCount: 0,
    createdAt: '2026-01-01T04:00:00.000Z',
    updatedAt: '2026-01-01T04:00:00.000Z',
  };

  await db.products.put(product);
  await db.settings.put(makeSettings({ id: 'app-settings', storeName: `Store ${label}` }));
  await db.cashMovements.put(cashMovement);
  await db.expenses.put(expense);
  await db.auditEvents.put(auditEvent);
  await db.syncQueue.put(syncJob);
}

describe('account-data-service integration', () => {
  beforeEach(async () => {
    await resetTestDb();
    await Dexie.delete(VAULT_DB_NAME).catch(() => undefined);
    window.localStorage.clear();
  });

  it('summarizes business data and unsynced work across all current local tables', async () => {
    await seedOperationalTables('summary');

    const summary = await getLocalDataSummary();

    expect(summary).toMatchObject({
      products: 1,
      settings: 1,
      auditEvents: 1,
      cashMovements: 1,
      expenses: 1,
      pending: 1,
      failed: 0,
      syncing: 0,
      blocked: 0,
      conflicts: 0,
      hasBusinessData: true,
      hasUnsyncedWork: true,
    });
  });

  it('saves and restores account snapshots including cash movements, expenses, audit events, settings, and sync queue', async () => {
    await seedOperationalTables('snapshot');

    const savedSummary = await saveCurrentAccountSnapshot('uid-snapshot');
    expect(savedSummary).toMatchObject({ products: 1, cashMovements: 1, expenses: 1, auditEvents: 1, pending: 1 });

    await db.products.clear();
    await db.settings.clear();
    await db.cashMovements.clear();
    await db.expenses.clear();
    await db.auditEvents.clear();
    await db.syncQueue.clear();

    await expect(restoreAccountSnapshot('uid-snapshot')).resolves.toBe(true);
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.settings.get('app-settings')).resolves.toMatchObject({ storeName: 'Store snapshot' });
    await expect(db.cashMovements.count()).resolves.toBe(1);
    await expect(db.expenses.count()).resolves.toBe(1);
    await expect(db.auditEvents.count()).resolves.toBe(1);
    await expect(db.syncQueue.count()).resolves.toBe(1);
  });

  it('switches account storage safely: saves the previous UID, clears runtime data for a new UID, then restores the previous UID later', async () => {
    setActiveUid('uid-a');
    await seedOperationalTables('a');

    await prepareRuntimeDbForUid('uid-b');

    expect(getActiveUid()).toBe('uid-b');
    await expect(db.products.count()).resolves.toBe(0);
    await expect(db.cashMovements.count()).resolves.toBe(0);

    await db.products.put(makeProduct({ id: 'product-b', barcode: '7290000000499', name: 'Product B' }));

    await prepareRuntimeDbForUid('uid-a');

    expect(getActiveUid()).toBe('uid-a');
    await expect(db.products.get('product-a')).resolves.toMatchObject({ name: 'Product a' });
    await expect(db.products.get('product-b')).resolves.toBeUndefined();
    await expect(db.cashMovements.count()).resolves.toBe(1);
  });
});
