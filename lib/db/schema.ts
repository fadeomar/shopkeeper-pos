import Dexie, { type Table } from 'dexie';
import type { Bill, BillItem, Customer, Product, Purchase, PurchaseItem, Settings, Shift, StockMovement, AuthCacheEntry, SyncQueueItem, CustomerPayment, Supplier, SupplierPayment, SyncConflict, PaymentMethod } from '@/types/domain';
import { deriveLegacySplit } from '@/lib/utils/bill-split';
import { normalizeCustomerKey, normalizePhone } from '@/lib/utils/customer-key';
import { createId } from '@/lib/utils/id';

export class ShopkeeperDB extends Dexie {
  products!: Table<Product, string>;
  bills!: Table<Bill, string>;
  billItems!: Table<BillItem, string>;
  stockMovements!: Table<StockMovement, string>;
  customerPayments!: Table<CustomerPayment, string>;
  customers!: Table<Customer, string>;
  shifts!: Table<Shift, string>;
  suppliers!: Table<Supplier, string>;
  purchases!: Table<Purchase, string>;
  purchaseItems!: Table<PurchaseItem, string>;
  supplierPayments!: Table<SupplierPayment, string>;
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

    // v6: backfills cashAmount/cardAmount/creditAmount on every existing bill.
    // No index changes — the new fields are stored on the row but not indexed
    // because reports aggregate them in memory. The upgrade callback is pure
    // and synchronous-per-row so it cannot wedge the database open.
    this.version(6).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
      syncConflicts: 'id, status, entity, entityId, conflictType, severity, createdAt',
    }).upgrade(async (tx) => {
      await tx.table<Bill, string>('bills').toCollection().modify((bill) => {
        if (
          typeof bill.cashAmount === 'number' &&
          typeof bill.cardAmount === 'number' &&
          typeof bill.creditAmount === 'number'
        ) {
          return;
        }
        const split = deriveLegacySplit(
          (bill.paymentMethod ?? 'cash') as PaymentMethod,
          Number(bill.totalAmount) || 0,
          Number(bill.paidAmount) || 0,
        );
        bill.cashAmount = split.cashAmount;
        bill.cardAmount = split.cardAmount;
        bill.creditAmount = split.creditAmount;
      });
    });

    // v7: adds the customers table and backfills it from existing bills.
    //
    // Scan every bill that carries a customerName or customerPhone snapshot,
    // group them by normalizeCustomerKey, create one Customer row per group
    // using the most recent name/phone seen, then stamp customerId back onto
    // every bill in the group. Bills without any customer info (walk-ins)
    // stay as-is with customerId undefined.
    //
    // The migration is idempotent — bills that already have a customerId
    // are skipped.
    this.version(7).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone, customerId',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      customers: 'id, name, normalizedPhone, createdAt, updatedAt',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
      syncConflicts: 'id, status, entity, entityId, conflictType, severity, createdAt',
    }).upgrade(async (tx) => {
      const billsTable = tx.table<Bill, string>('bills');
      const customersTable = tx.table<Customer, string>('customers');
      const bills = await billsTable.toArray();
      const now = new Date().toISOString();

      // Group existing bills by their normalized key.
      const groups = new Map<string, { name: string; phone?: string; bills: Bill[] }>();
      for (const bill of bills) {
        if (bill.customerId) continue;
        const key = normalizeCustomerKey({ name: bill.customerName, phone: bill.customerPhone });
        if (!key) continue;
        const existing = groups.get(key);
        if (existing) {
          existing.bills.push(bill);
          // Prefer the most recently created bill's name/phone snapshot.
          if (bill.createdAt > (existing.bills[0]?.createdAt ?? '')) {
            if (bill.customerName?.trim()) existing.name = bill.customerName.trim();
            if (bill.customerPhone?.trim()) existing.phone = bill.customerPhone.trim();
          }
        } else {
          groups.set(key, {
            name: bill.customerName?.trim() || 'Customer',
            phone: bill.customerPhone?.trim() || undefined,
            bills: [bill],
          });
        }
      }

      const customerByKey = new Map<string, string>(); // key -> customer.id
      const customerRows: Customer[] = [];
      for (const [key, group] of groups) {
        const id = createId('cust');
        customerByKey.set(key, id);
        customerRows.push({
          id,
          name: group.name,
          phone: group.phone,
          normalizedPhone: normalizePhone(group.phone) || undefined,
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
        });
      }

      if (customerRows.length > 0) {
        await customersTable.bulkAdd(customerRows);
      }

      await billsTable.toCollection().modify((bill) => {
        if (bill.customerId) return;
        const key = normalizeCustomerKey({ name: bill.customerName, phone: bill.customerPhone });
        const id = key ? customerByKey.get(key) : undefined;
        if (id) bill.customerId = id;
      });
    });

    // v8: cash-drawer shifts. Adds a shifts table and indexes shiftId on
    // bills so per-shift cash reconciliation can be computed efficiently.
    // No data migration is needed — existing bills simply carry no shiftId
    // (they predate shift tracking and won't appear in any shift's totals).
    this.version(8).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone, customerId, shiftId',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      customers: 'id, name, normalizedPhone, createdAt, updatedAt',
      shifts: 'id, status, openedAt, closedAt',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
      syncConflicts: 'id, status, entity, entityId, conflictType, severity, createdAt',
    });

    // v9: supplier domain — the buy-side mirror of customers + bills.
    //   suppliers      ↔ customers
    //   purchases      ↔ bills            (with shiftId for drawer link)
    //   purchaseItems  ↔ billItems
    //   supplierPayments ↔ customerPayments
    // No data migration needed; all four tables start empty for existing users.
    this.version(9).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated',
      bills: 'id, &billNumber, createdAt, paymentMethod, status, cashierName, customerName, customerPhone, customerId, shiftId',
      billItems: 'id, billId, originalProductId, barcodeAtSale, productNameAtSale, categoryAtSale, createdAt',
      stockMovements: 'id, productId, movementType, referenceType, referenceId, createdAt',
      customerPayments: 'id, customerKey, createdAt, syncStatus',
      customers: 'id, name, normalizedPhone, createdAt, updatedAt',
      shifts: 'id, status, openedAt, closedAt',
      suppliers: 'id, name, normalizedPhone, createdAt, updatedAt',
      purchases: 'id, &purchaseNumber, createdAt, paymentMethod, status, supplierName, supplierPhone, supplierId, shiftId',
      purchaseItems: 'id, purchaseId, originalProductId, barcodeAtPurchase, productNameAtPurchase, categoryAtPurchase, createdAt',
      supplierPayments: 'id, supplierKey, createdAt, syncStatus, shiftId',
      settings: 'id, updatedAt',
      authCache: 'uid',
      syncQueue: 'id, status, entity, entityId, createdAt, updatedAt',
      syncConflicts: 'id, status, entity, entityId, conflictType, severity, createdAt',
    });
  }
}

export const db = new ShopkeeperDB();
