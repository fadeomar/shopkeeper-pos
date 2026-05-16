export type EntityStatus = 'active' | 'inactive';
export type UserRole = 'admin' | 'cashier';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'blocked';
export type SyncEntity = 'bill' | 'product' | 'settings' | 'stockMovement' | 'customerPayment' | 'customer' | 'shift' | 'supplier' | 'purchase' | 'supplierPayment';
export type SyncOperation = 'create' | 'update' | 'delete' | 'upsert';

export interface SyncQueueItem {
  id: string;
  entity: SyncEntity;
  entityId: string;
  operation: SyncOperation;
  payload?: unknown;
  status: SyncStatus;
  retryCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  syncedAt?: string;
}


export type SyncConflictType = 'same_field_changed' | 'delete_vs_update' | 'duplicate_record' | 'inventory_overwrite' | 'sale_state_conflict' | 'settings_conflict' | 'unknown';
export type SyncConflictSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SyncConflictResolution = 'keep_cloud' | 'keep_local' | 'merge' | 'keep_both' | 'delete' | 'manual';
export interface SyncConflict {
  id: string;
  entity: SyncEntity;
  entityId: string;
  operationId?: string;
  conflictType: SyncConflictType;
  severity: SyncConflictSeverity;
  cloudRecord: Record<string, unknown>;
  localRecord: Record<string, unknown>;
  baseRecord?: Record<string, unknown>;
  changedFields: string[];
  status: 'open' | 'resolved' | 'ignored';
  resolution?: SyncConflictResolution;
  createdAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
}

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  isActive: boolean;
  pendingApproval?: boolean;
  createdAt: string;
}

export interface AuthCacheEntry extends AppUser {
  cachedAt: string;
}
export type BillStatus = 'finalized' | 'voided' | 'partially_returned' | 'returned';
export type PaymentMethod = 'cash' | 'card' | 'mixed' | 'credit';
export type StockMovementType = 'purchase' | 'sale' | 'adjustment' | 'return' | 'damaged' | 'initial';
export type ReferenceType = 'product' | 'bill' | 'purchase' | 'adjustment' | 'seed';

export interface Product {
  id: string;
  barcode: string;
  name: string;
  category: string;
  brand?: string;
  unit: string;
  quantityInStock: number;
  buyPrice: number;
  sellPrice: number;
  minimumStockAlert: number;
  supplierName?: string;
  dateAdded: string;
  lastUpdated: string;
  expiryDate?: string;
  shelfLocation?: string;
  notes?: string;
  status: EntityStatus;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface Bill {
  id: string;
  billNumber: string;
  createdAt: string;
  cashierName?: string;
  // Reference into the customers table (populated for credit sales and
  // anywhere the cashier selected/created a customer). The name/phone fields
  // below stay as immutable snapshots so receipts, audit, and reports work
  // even if the customer record is later renamed.
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: PaymentMethod;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  // Payment-split amounts. Invariant for finalized bills:
  //   cashAmount + cardAmount + creditAmount === totalAmount
  // Returns/voids leave these gross numbers intact and reduce them via
  // returnedAmount + proportional allocation at read time. Local bills are
  // guaranteed to have these via the Dexie v6 upgrade. Cloud bills written
  // by older devices may not — readers should treat them as optional with
  // `?? 0` fallback or run them through normalizeBillSplit().
  cashAmount: number;
  cardAmount: number;
  creditAmount: number;
  totalProfit: number;
  itemCount: number;
  status: BillStatus;
  // Set at finalize when a shift is open on this device; left undefined when
  // no shift is open (the shop doesn't use drawer reconciliation, or the
  // cashier forgot to open one). Reports/drawer math only count bills that
  // carry the active shift's id.
  shiftId?: string;
  notes?: string;
  voidedAt?: string;
  voidReason?: string;
  returnedAmount?: number;
  returnedProfit?: number;
  lastReturnAt?: string;
  lastReturnReason?: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface BillItem {
  id: string;
  billId: string;
  originalProductId: string;
  barcodeAtSale: string;
  productNameAtSale: string;
  categoryAtSale: string;
  quantitySold: number;
  unitBuyPriceAtSale: number;
  unitSellPriceAtSale: number;
  lineSubtotal: number;
  lineProfit: number;
  quantityReturned?: number;
  createdAt: string;
}

export type ShiftStatus = 'open' | 'closed';

/**
 * A cashier session bracketing the cash drawer between opening and closing.
 * Bills created while a shift is `open` carry that shift's id (Bill.shiftId);
 * at close, expected cash equals openingCash + net cash collected for those
 * bills (sales − proportional return refunds). cashDifference = counted −
 * expected, allowing variance audit.
 */
export interface Shift {
  id: string;
  openedAt: string;
  openedByCashierName: string;
  openingCash: number;
  notes?: string;
  status: ShiftStatus;
  // Populated when the shift is closed.
  closedAt?: string;
  expectedCash?: number;
  countedCash?: number;
  cashDifference?: number;
  closingNotes?: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string;
  // Digits-only canonical phone for the Dexie index — lets dedup tolerate
  // spaces, dashes, and country-code variations.
  normalizedPhone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

/**
 * A supplier we buy stock from. Structurally identical to Customer — the
 * difference is direction-of-flow: a customer owes us money, we owe a
 * supplier money.
 */
export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  normalizedPhone?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

/**
 * A purchase delivery from one supplier — the buy-side mirror of Bill.
 * Same payment-split invariant: cashAmount + cardAmount + creditAmount ===
 * totalAmount. cashAmount represents money paid OUT of the drawer (negative
 * pressure on shift cash), creditAmount represents money we owe the
 * supplier. No totalProfit field — purchases produce cost, not profit.
 */
export interface Purchase {
  id: string;
  purchaseNumber: string;
  createdAt: string;
  cashierName?: string;
  supplierId?: string;
  supplierName?: string;
  supplierPhone?: string;
  paymentMethod: PaymentMethod;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  changeAmount: number;
  cashAmount: number;
  cardAmount: number;
  creditAmount: number;
  itemCount: number;
  status: BillStatus;
  shiftId?: string;
  notes?: string;
  voidedAt?: string;
  voidReason?: string;
  returnedAmount?: number;
  lastReturnAt?: string;
  lastReturnReason?: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

/**
 * Line item snapshot at the moment of purchase — mirror of BillItem.
 * unitCostAtPurchase is what we paid the supplier per unit. No
 * unitSellPrice or lineProfit fields — that's a sell-side concept.
 */
export interface PurchaseItem {
  id: string;
  purchaseId: string;
  originalProductId: string;
  barcodeAtPurchase: string;
  productNameAtPurchase: string;
  categoryAtPurchase: string;
  quantityPurchased: number;
  unitCostAtPurchase: number;
  lineSubtotal: number;
  quantityReturned?: number;
  createdAt: string;
}

/**
 * A payment we made to a supplier against their debt — mirror of
 * CustomerPayment. supplierKey + supplierName/Phone are kept as snapshots
 * for the same reasons CustomerPayment keeps customerKey/Name (so old rows
 * still resolve after rename), and shiftId binds cash payments to the
 * drawer for end-of-shift reconciliation.
 */
export interface SupplierPayment {
  id: string;
  supplierKey: string;
  supplierName: string;
  supplierPhone?: string;
  amount: number;
  note?: string;
  paymentMethod?: 'cash' | 'card' | 'bank' | 'other';
  createdAt: string;
  shiftId?: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface CustomerPayment {
  id: string;
  customerKey: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  note?: string;
  paymentMethod?: 'cash' | 'card' | 'bank' | 'other';
  shiftId?: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  movementType: StockMovementType;
  quantityChange: number;
  referenceType: ReferenceType;
  referenceId: string;
  note?: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface Settings {
  id: string;
  storeName: string;
  cashierName?: string;
  currency: string;
  allowLossSale: boolean;
  nextBillSequence: number;
  lowStockHighlight: boolean;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface ProductFormValues {
  barcode: string;
  name: string;
  category: string;
  brand?: string;
  unit: string;
  quantityInStock: number;
  buyPrice: number;
  sellPrice: number;
  minimumStockAlert: number;
  supplierName?: string;
  dateAdded: string;
  expiryDate?: string;
  shelfLocation?: string;
  notes?: string;
  status: EntityStatus;
}

export interface PurchaseDraftItem {
  productId: string;
  barcode: string;
  name: string;
  category: string;
  // No availableStock check on the buy side — we're adding inventory.
  // Existing stock is shown read-only in the UI just for context.
  currentStock: number;
  quantity: number;
  unitCost: number;
  // Pre-purchase sell price (informational; we don't mutate sellPrice during
  // a purchase, but the cashier may want to see it for margin sanity check).
  unitSellPriceBefore: number;
}

export interface PurchaseFormValues {
  cashierName?: string;
  supplierName?: string;
  supplierPhone?: string;
  paymentMethod: PaymentMethod;
  discountAmount: number;
  taxAmount: number;
  paidAmount: number;
  cashAmount?: number;
  cardAmount?: number;
  notes?: string;
}

export interface BillDraftItem {
  productId: string;
  barcode: string;
  name: string;
  category: string;
  availableStock: number;
  quantity: number;
  unitBuyPrice: number;
  unitSellPrice: number;
}

export interface BillFormValues {
  cashierName?: string;
  customerName?: string;
  customerPhone?: string;
  paymentMethod: PaymentMethod;
  discountAmount: number;
  taxAmount: number;
  paidAmount: number;
  // For 'mixed' payment method: explicit cash + card breakdown that must sum
  // to totalAmount. Ignored for cash/card/credit (the service derives those
  // fields from paymentMethod + paidAmount).
  cashAmount?: number;
  cardAmount?: number;
  notes?: string;
}
