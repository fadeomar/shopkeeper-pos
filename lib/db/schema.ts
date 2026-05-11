import Dexie, { type Table } from 'dexie';
import type { Bill, BillItem, Product, Settings, StockMovement, AuthCacheEntry, SyncQueueItem, CustomerPayment, SyncConflict } from '@/types/domain';

export class ShopkeeperDB extends Dexie {
  products!: Table<Product, string>;
  bills!: Table<Bill, string>;
  billItems!: Table<BillItem, string>;
  stockMovements!: Table<StockMovement, string>;
  customerPayments!: Table<CustomerPayment, string>;
  settings!: Table<Settings, string>;
  authCache!: Table<AuthCacheEntry, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  syncConflicts!: Table<SyncConflict, string>;

  constructor() {
    super('shopkeeper-pos-db');

    this.version(1).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      settings: 'id, updatedAt',
    });

    // version(N).stores() must re-declare ALL tables — omitting one drops it on fresh installs.
    this.version(2).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      settings: 'id, updatedAt',
      authCache: 'uid',
    });

    // v3: adds the durable sync queue. Existing tables are unchanged; no data migration needed.
    this.version(3).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
    });

    // v4: customer debt payments for the credit/customer ledger.
    this.version(4).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
    });

    // v5: local conflict records for explicit conflict review UX.
    this.version(5).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
      syncConflicts: 'id, status, entity, entityId, conflictType, severity, createdAt',
    });
  }
}

export const db = new ShopkeeperDB();
