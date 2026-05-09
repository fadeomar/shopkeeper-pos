import Dexie, { type Table } from 'dexie';
import type { Bill, BillItem, Product, Settings, StockMovement, AuthCacheEntry, SyncQueueItem } from '@/types/domain';

export class ShopkeeperDB extends Dexie {
  products!: Table<Product, string>;
  bills!: Table<Bill, string>;
  billItems!: Table<BillItem, string>;
  stockMovements!: Table<StockMovement, string>;
  settings!: Table<Settings, string>;
  authCache!: Table<AuthCacheEntry, string>;
  syncQueue!: Table<SyncQueueItem, string>;

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
  }
}

export const db = new ShopkeeperDB();
