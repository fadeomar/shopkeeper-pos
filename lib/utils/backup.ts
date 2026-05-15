import { db } from '@/lib/db/schema';
import type { Bill, BillItem, Customer, CustomerPayment, Product, Purchase, PurchaseItem, Settings, Shift, StockMovement, Supplier, SupplierPayment, SyncConflict, SyncQueueItem } from '@/types/domain';

/**
 * Portable local backup format.
 * JSON is only used for manual export/support snapshots, never as live storage.
 *
 * Snapshots are append-only on field additions — older parsers will see
 * `undefined` for new fields and can safely default. The `version` field
 * stays at 1 until we make a breaking change to the shape.
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
    customers: number;
    shifts: number;
    suppliers: number;
    purchases: number;
    purchaseItems: number;
    supplierPayments: number;
    settings: number;
    syncQueue: number;
    syncConflicts: number;
  };
  data: {
    products: Product[];
    bills: Bill[];
    billItems: BillItem[];
    stockMovements: StockMovement[];
    customerPayments: CustomerPayment[];
    customers: Customer[];
    shifts: Shift[];
    suppliers: Supplier[];
    purchases: Purchase[];
    purchaseItems: PurchaseItem[];
    supplierPayments: SupplierPayment[];
    settings: Settings[];
    syncQueue: SyncQueueItem[];
    syncConflicts: SyncConflict[];
  };
}

export async function createLocalBackupSnapshot(): Promise<BackupSnapshotV1> {
  const [products, bills, billItems, stockMovements, customerPayments, customers, shifts, suppliers, purchases, purchaseItems, supplierPayments, settings, syncQueue, syncConflicts] = await Promise.all([
    db.products.toArray(),
    db.bills.toArray(),
    db.billItems.toArray(),
    db.stockMovements.toArray(),
    db.customerPayments.toArray(),
    db.customers.toArray(),
    db.shifts.toArray().catch(() => [] as Shift[]),
    db.suppliers.toArray().catch(() => [] as Supplier[]),
    db.purchases.toArray().catch(() => [] as Purchase[]),
    db.purchaseItems.toArray().catch(() => [] as PurchaseItem[]),
    db.supplierPayments.toArray().catch(() => [] as SupplierPayment[]),
    db.settings.toArray(),
    db.syncQueue.toArray(),
    db.syncConflicts.toArray().catch(() => [] as SyncConflict[]),
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
      customers: customers.length,
      shifts: shifts.length,
      suppliers: suppliers.length,
      purchases: purchases.length,
      purchaseItems: purchaseItems.length,
      supplierPayments: supplierPayments.length,
      settings: settings.length,
      syncQueue: syncQueue.length,
      syncConflicts: syncConflicts.length,
    },
    data: {
      products,
      bills,
      billItems,
      stockMovements,
      customerPayments,
      customers,
      shifts,
      suppliers,
      purchases,
      purchaseItems,
      supplierPayments,
      settings,
      syncQueue,
      syncConflicts,
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
      customers: 0,
      shifts: 0,
      suppliers: 0,
      purchases: 0,
      purchaseItems: 0,
      supplierPayments: 0,
      settings: 0,
      syncQueue: 0,
      syncConflicts: 0,
    },
    data: {
      products: [],
      bills: [],
      billItems: [],
      stockMovements: [],
      customerPayments: [],
      customers: [],
      shifts: [],
      suppliers: [],
      purchases: [],
      purchaseItems: [],
      supplierPayments: [],
      settings: [],
      syncQueue: [],
      syncConflicts: [],
    },
  };
}
