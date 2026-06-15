import Dexie, { type Table } from 'dexie';
import type { AuditEvent, Bill, BillItem, BillItemCostAllocation, CashMovement, Customer, Expense, InventoryLot, Product, ProductUnit, Purchase, PurchaseItem, Settings, Shift, StockMovement, AuthCacheEntry, SyncQueueItem, CustomerPayment, Supplier, SupplierPayment, SyncConflict, PaymentMethod } from '@/types/domain';
import { deriveLegacySplit } from '@/lib/utils/bill-split';
import { normalizeCustomerKey, normalizePhone } from '@/lib/utils/customer-key';
import { createId } from '@/lib/utils/id';
import { OPENING_LOT_SOURCE_ID, buildOpeningLot } from '@/lib/db/inventory-lot-migration';

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
  auditEvents!: Table<AuditEvent, string>;
  cashMovements!: Table<CashMovement, string>;
  expenses!: Table<Expense, string>;
  inventoryLots!: Table<InventoryLot, string>;
  billItemCostAllocations!: Table<BillItemCostAllocation, string>;
  productUnits!: Table<ProductUnit, string>;

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

    // v10: add shiftId index to customerPayments so cash customer debt
    // payments can be queried by shift for cash drawer reconciliation.
    this.version(10).stores({
      customerPayments: 'id, customerKey, createdAt, syncStatus, shiftId',
    });

    // v11: split bill and purchase sequences so INV-XXXXXX and PO-XXXXXX
    // counters advance independently. Existing settings rows are backfilled
    // with nextPurchaseSequence = nextBillSequence so any PO numbers already
    // issued from the shared counter are not repeated.
    this.version(11).stores({}).upgrade(async (tx) => {
      await tx.table('settings').toCollection().modify((s: Record<string, unknown>) => {
        if (typeof s.nextPurchaseSequence !== 'number') {
          s.nextPurchaseSequence = typeof s.nextBillSequence === 'number' ? s.nextBillSequence : 1;
        }
      });
    });

    // v12: append-only audit event log. Index category + createdAt for the
    // /audit page's filter UI, entityId so the bill/product detail pages can
    // show their own slice of the history, and syncStatus so the sync engine
    // can find pending rows. No data migration — table starts empty.
    this.version(12).stores({
      auditEvents: 'id, category, action, entityId, actorUid, shiftId, createdAt, syncStatus',
    });

    // v13: manual cash drawer movements. Index type for the /cash filter UI,
    // shiftId so closeShift can sum the shift's movements without scanning
    // every row, and createdAt for the page's "newest first" sort.
    this.version(13).stores({
      cashMovements: 'id, type, shiftId, createdAt, syncStatus',
    });

    // v14: operational expenses (rent, utilities, salaries, etc.). Indexed
    // by category for the reports filter, paymentMethod so closeShift can
    // efficiently pull just the cash ones, and shiftId so per-shift cash-out
    // calculation matches what the cashier sees in the drawer.
    this.version(14).stores({
      expenses: 'id, category, paymentMethod, shiftId, expenseDate, createdAt, syncStatus',
    });

    // v15: the shop operates in ILS (₪). Flip any settings row still carrying
    // the old "USD"/"$" currency over to ILS so existing installs show ₪
    // without a manual step. Runs exactly once on upgrade; a store that later
    // deliberately picks another currency in Settings keeps its choice.
    this.version(15).stores({}).upgrade(async (tx) => {
      await tx.table('settings').toCollection().modify((s: Record<string, unknown>) => {
        if (s.currency === 'USD' || s.currency === '$') {
          s.currency = 'ILS';
        }
      });
    });

    // v16: FIFO inventory costing. Adds two tables:
    //   inventoryLots             — one batch of received stock at a known cost
    //   billItemCostAllocations   — which lot(s) each sold bill item consumed
    //
    // Migration: create one opening-balance lot for every product that still
    // has stock, so existing inventory has a cost basis for future FIFO sales.
    // Products at 0 stock get nothing. The upgrade is idempotent — if an
    // opening lot already exists for a product/source it is not duplicated, so
    // a partially-applied upgrade can be safely re-run.
    this.version(16).stores({
      inventoryLots: 'id, productId, sourceType, sourceId, sourceItemId, receivedAt, status, syncStatus',
      billItemCostAllocations: 'id, billId, billItemId, productId, inventoryLotId, createdAt, syncStatus',
    }).upgrade(async (tx) => {
      const productsTable = tx.table<Product, string>('products');
      const lotsTable = tx.table<InventoryLot, string>('inventoryLots');
      const now = new Date().toISOString();

      // Which products already have an opening lot (idempotency guard).
      const existingOpeningLots = await lotsTable
        .where('sourceId')
        .equals(OPENING_LOT_SOURCE_ID)
        .toArray();
      const productsWithOpeningLot = new Set(existingOpeningLots.map((lot) => lot.productId));

      const products = await productsTable.toArray();
      const newLots: InventoryLot[] = [];
      for (const product of products) {
        if (productsWithOpeningLot.has(product.id)) continue;
        const lot = buildOpeningLot(product, now);
        if (lot) newLots.push(lot);
      }
      if (newLots.length > 0) {
        await lotsTable.bulkAdd(newLots);
      }
    });

    // v17: weight-based products. Adds a saleType index to products so the
    // inventory UI can filter weighted vs unit products. No data migration:
    // a product with no saleType is treated as 'unit' everywhere, so existing
    // rows keep their meaning (quantityInStock stays a piece count, sellPrice
    // a per-piece price). The other new weight fields (baseUnit on lots,
    // baseQuantity* on bill/purchase items) are stored un-indexed on the row.
    this.version(17).stores({
      products: 'id, &barcode, name, category, brand, supplierName, status, quantityInStock, minimumStockAlert, dateAdded, lastUpdated, saleType',
    });

    // v18: multi-unit products (pharmacy pill/strip/box, supermarket
    // carton/pack/piece). Adds the productUnits child table — one row per
    // sellable/purchasable unit of a `multi_unit` product. Indexed by productId
    // (load a product's units), barcode (scan-to-unit lookup), and syncStatus
    // (sync engine finds pending rows). No data migration: the table starts
    // empty and every existing product stays 'unit'/'weight' with no units, so
    // helpers synthesize a virtual base unit for them. Product gains an
    // un-indexed defaultSaleUnitId; bill/purchase items gain un-indexed
    // saleUnit*/purchaseUnit* snapshot fields stored on the row.
    this.version(18).stores({
      productUnits: 'id, productId, barcode, syncStatus',
    });
  }
}

export const db = new ShopkeeperDB();
