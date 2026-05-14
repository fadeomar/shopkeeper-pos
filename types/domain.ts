export type EntityStatus = 'active' | 'inactive';
export type UserRole = 'admin' | 'cashier';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'blocked';
export type SyncEntity = 'bill' | 'product' | 'settings' | 'stockMovement' | 'customerPayment';
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
export type ReferenceType = 'product' | 'bill' | 'adjustment' | 'seed';

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

export interface CustomerPayment {
  id: string;
  customerKey: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  note?: string;
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
