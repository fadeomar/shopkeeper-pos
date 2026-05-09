export type EntityStatus = 'active' | 'inactive';
export type UserRole = 'admin' | 'cashier';

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';
export type SyncEntity = 'bill' | 'product' | 'settings' | 'stockMovement';
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
export type BillStatus = 'finalized' | 'voided';
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
  totalProfit: number;
  itemCount: number;
  status: BillStatus;
  notes?: string;
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
  createdAt: string;
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
  notes?: string;
}
