import Dexie, { type Table } from 'dexie';
import type { Bill, BillItem, Product, Settings, StockMovement } from '@/types/domain';

export class ShopkeeperDB extends Dexie {
  products!: Table<Product, string>;
  bills!: Table<Bill, string>;
  billItems!: Table<BillItem, string>;
  stockMovements!: Table<StockMovement, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('shopkeeper-pos-db');

    this.version(1).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      settings: 'id, updatedAt',
    });

    // Future migrations should use version(2).upgrade(...) to preserve local user data.
  }
}

export const db = new ShopkeeperDB();
