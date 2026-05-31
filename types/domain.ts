export type EntityStatus = 'active' | 'inactive';
export type UserRole = 'owner' | 'manager' | 'cashier' | 'accountant';

export interface RolePermissions {
  canVoid: boolean;
  canReturn: boolean;
  canDiscount: boolean;
  canViewProfit: boolean;
  canEditCost: boolean;
  canExport: boolean;
  canManageSettings: boolean;
  canManageRolePermissions: boolean;
}

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  owner: {
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: true,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  },
  manager: {
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: false,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: false,
  },
  // Cashier is the top role on the shop/user side: the POS owner's own
  // account. It controls the whole shop — editing buy price, managing settings,
  // viewing profit, voiding, etc. The `owner` role above is the SaaS operator
  // who only manages users from the admin dashboard and never touches the POS,
  // so the cashier (not owner) is the role that needs full POS capability.
  cashier: {
    canVoid: true,
    canReturn: true,
    canDiscount: true,
    canViewProfit: true,
    canEditCost: true,
    canExport: true,
    canManageSettings: true,
    canManageRolePermissions: true,
  },
  accountant: {
    canVoid: false,
    canReturn: false,
    canDiscount: false,
    canViewProfit: true,
    canEditCost: false,
    canExport: true,
    canManageSettings: false,
    canManageRolePermissions: false,
  },
};

/**
 * The "deny everything" permission set. Used as a fail-closed fallback when the
 * current user's role cannot be determined (e.g. no cached auth entry). We can
 * no longer fall back to a real role for this: `cashier` — the old "most
 * restrictive" default — is now the top shop-side role with full permissions,
 * so assuming any role would fail OPEN. An unknown caller must get nothing.
 */
export const NO_PERMISSIONS: RolePermissions = {
  canVoid: false,
  canReturn: false,
  canDiscount: false,
  canViewProfit: false,
  canEditCost: false,
  canExport: false,
  canManageSettings: false,
  canManageRolePermissions: false,
};

/**
 * Meta-permissions that gate who may change settings and the role-permission
 * matrix itself. These are deliberately NOT overridable via
 * settings.rolePermissions: if they were, a low-role user who edited their
 * local settings object (IndexedDB is fully client-writable) could grant
 * themselves the very permission that protects the app, then escalate to
 * everything else. They are always resolved from DEFAULT_ROLE_PERMISSIONS for
 * the user's role and ignore any stored override.
 */
export const NON_OVERRIDABLE_PERMISSIONS = [
  'canManageSettings',
  'canManageRolePermissions',
] as const satisfies ReadonlyArray<keyof RolePermissions>;

/**
 * Resolve the effective permissions for a role: role defaults with stored
 * overrides applied on top, EXCEPT the non-overridable meta-permissions which
 * always come from the role defaults. Shared by the React hook and the
 * service-layer guard so both compute identical, escalation-proof results.
 */
export function resolveRolePermissions(
  role: UserRole,
  overrides?: Partial<RolePermissions>,
): RolePermissions {
  const base = DEFAULT_ROLE_PERMISSIONS[role] ?? DEFAULT_ROLE_PERMISSIONS.cashier;
  const resolved: RolePermissions = { ...base, ...(overrides ?? {}) };
  for (const key of NON_OVERRIDABLE_PERMISSIONS) {
    resolved[key] = base[key];
  }
  return resolved;
}

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict' | 'blocked';
export type SyncEntity = 'bill' | 'product' | 'settings' | 'stockMovement' | 'customerPayment' | 'customer' | 'shift' | 'supplier' | 'purchase' | 'supplierPayment' | 'auditEvent' | 'cashMovement' | 'expense';
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
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
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
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
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
  nextPurchaseSequence: number;
  lowStockHighlight: boolean;
  // Business profile
  businessAddress?: string;
  businessPhone?: string;
  // POS behaviour
  taxMode?: 'inclusive' | 'exclusive' | 'none';
  defaultDiscountLimit?: number;
  requireShift?: boolean;
  // Receipt
  receiptHeader?: string;
  receiptFooter?: string;
  // Payment method toggles (undefined = enabled)
  enableCash?: boolean;
  enableCard?: boolean;
  enableCredit?: boolean;
  // Inventory alerts
  lowStockThreshold?: number;
  expiryWarningDays?: number;
  // Role-level permission overrides. Values override DEFAULT_ROLE_PERMISSIONS.
  rolePermissions?: Partial<Record<UserRole, Partial<RolePermissions>>>;
  createdAt: string;
  updatedAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

/**
 * Audit log — append-only history of business-meaningful actions. Used by
 * the /audit page so an owner can see who voided a bill, when stock was
 * adjusted, when settings changed, who resolved a sync conflict, etc.
 *
 * Events are append-only — never edited or deleted from this device. Sync
 * is one-way (push to cloud) so audit history survives across devices.
 */
export type AuditCategory =
  | 'product'
  | 'inventory'
  | 'bill'
  | 'purchase'
  | 'customer'
  | 'supplier'
  | 'settings'
  | 'shift'
  | 'user'
  | 'sync';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'void'
  | 'return'
  | 'payment'
  | 'stock_adjust'
  | 'open'
  | 'close'
  | 'approve'
  | 'reject'
  | 'deactivate'
  | 'reactivate'
  | 'reset_link'
  | 'resolve_conflict'
  | 'price_change';

/**
 * Manual cash drawer event — anything that moves cash in or out of the
 * register that isn't a sale, purchase, or customer/supplier payment.
 *
 *   cash_in           — positive: owner top-up, change reserve, refund float, etc.
 *   cash_out          — negative: misc payout the cashier doesn't want to
 *                       classify further.
 *   owner_withdrawal  — negative: owner takes cash from the drawer.
 *   bank_deposit      — negative: cash transferred to bank.
 *   petty_cash        — negative: small expense paid from the drawer (rent
 *                       collector, taxi, snack run). The expenses module
 *                       (sprint follow-up) will replace most of these with
 *                       categorized Expense rows, but petty_cash stays as a
 *                       quick "don't care to classify" option.
 *   drawer_correction — signed: positive if cashier found more cash than
 *                       expected, negative if less. Used during the day
 *                       (mid-shift) to reconcile without forcing a close.
 *
 * Stored with a signed `amount` so summing the column directly gives the
 * net effect on the drawer. UI surfaces present positive numbers and a
 * "money in" / "money out" toggle for clarity.
 */
export type CashMovementType =
  | 'cash_in'
  | 'cash_out'
  | 'owner_withdrawal'
  | 'bank_deposit'
  | 'petty_cash'
  | 'drawer_correction';

export interface CashMovement {
  id: string;
  type: CashMovementType;
  /** Signed amount. Positive = into drawer, negative = out of drawer. */
  amount: number;
  reason?: string;
  /** Reference label captured at the time (e.g. "Owner: Ali", "Bank slip 4421"). */
  referenceLabel?: string;
  shiftId?: string;
  cashierName?: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

/**
 * Operational expense — anything the store pays for that isn't a Purchase
 * (which is inventory-affecting). Lives in its own table so reports can
 * distinguish "money spent on stock to sell" from "money spent to keep the
 * lights on".
 *
 * Note on cash-drawer interaction: a 'cash' expense recorded while a shift
 * is open is included by closeShift in the cash-out calculation, alongside
 * supplier payments and cash CashMovements. We do NOT create a separate
 * CashMovement row for it — that would double-count the drawer impact.
 */
export type ExpenseCategory =
  | 'rent'
  | 'utilities'      // electricity, water, gas
  | 'internet'
  | 'salaries'
  | 'packaging'
  | 'delivery'
  | 'maintenance'
  | 'marketing'
  | 'transport'
  | 'cleaning'
  | 'office'
  | 'tax'
  | 'fees'           // bank fees, license fees
  | 'other';

export type ExpensePaymentMethod = 'cash' | 'card' | 'bank' | 'credit';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  /** Optional payee — supplier-like label for who got paid (e.g. "PalTel", "Landlord"). */
  payee?: string;
  note?: string;
  shiftId?: string;
  cashierName?: string;
  /** Optional date the expense applies to (e.g. rent for which month). Defaults to createdAt's date. */
  expenseDate?: string;
  createdAt: string;
  syncStatus?: SyncStatus;
  syncedAt?: string;
  lastSyncError?: string;
}

export interface AuditEvent {
  id: string;
  category: AuditCategory;
  action: AuditAction;
  /** ID of the affected entity (bill id, product id, etc.). Optional for global actions like settings save. */
  entityId?: string;
  /** Human-readable label (bill number, product name) — captured at event time so the log survives entity deletion. */
  entityLabel?: string;
  /** UID of the user who triggered the action (when available). */
  actorUid?: string;
  /** Display name of the actor at action time. */
  actorName?: string;
  /** Optional reason supplied by the user (void reason, return reason, etc.). */
  reason?: string;
  /** Compact human-readable summary of the change ("price 5.00 → 6.50", "stock −3"). Avoid full record dumps. */
  summary?: string;
  /** Free-form metadata, kept small. Use sparingly. */
  metadata?: Record<string, string | number | boolean | null>;
  shiftId?: string;
  createdAt: string;
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
