import { db } from '@/lib/db/schema';
import type { Bill, BillItem, CustomerPayment, Product, Settings, StockMovement, SyncQueueItem } from '@/types/domain';

/**
 * Portable local backup format.
 * JSON is only used for manual export/support snapshots, never as live storage.
 */
export interface BackupSnapshotV1 {
  version: 1;
  exportedAt: string;
  app: 'shopkeeper-pos';
  counts: {
    products: number;
    bills: number;
    billItems: number;
    stockMovements: number;
    customerPayments: number;
    settings: number;
    syncQueue: number;
  };
  data: {
    products: Product[];
    bills: Bill[];
    billItems: BillItem[];
    stockMovements: StockMovement[];
    customerPayments: CustomerPayment[];
    settings: Settings[];
    syncQueue: SyncQueueItem[];
  };
}

export async function createLocalBackupSnapshot(): Promise<BackupSnapshotV1> {
  const [products, bills, billItems, stockMovements, customerPayments, settings, syncQueue] = await Promise.all([
    db.products.toArray(),
    db.bills.toArray(),
    db.billItems.toArray(),
    db.stockMovements.toArray(),
    db.customerPayments.toArray(),
    db.settings.toArray(),
    db.syncQueue.toArray(),
  ]);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'shopkeeper-pos',
    counts: {
      products: products.length,
      bills: bills.length,
      billItems: billItems.length,
      stockMovements: stockMovements.length,
      customerPayments: customerPayments.length,
      settings: settings.length,
      syncQueue: syncQueue.length,
    },
    data: {
      products,
      bills,
      billItems,
      stockMovements,
      customerPayments,
      settings,
      syncQueue,
    },
  };
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function createEmptyBackupPlan(): BackupSnapshotV1 {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'shopkeeper-pos',
    counts: {
      products: 0,
      bills: 0,
      billItems: 0,
      stockMovements: 0,
      customerPayments: 0,
      settings: 0,
      syncQueue: 0,
    },
    data: {
      products: [],
      bills: [],
      billItems: [],
      stockMovements: [],
      customerPayments: [],
      settings: [],
      syncQueue: [],
    },
  };
}
