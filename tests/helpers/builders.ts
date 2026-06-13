import type {
  AppUser,
  BillDraftItem,
  BillFormValues,
  Product,
  PurchaseDraftItem,
  PurchaseFormValues,
  Settings,
} from '@/types/domain';

export function makeProduct(overrides: Partial<Product> = {}): Product {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'product-1',
    barcode: '1234567890123',
    name: 'Test product',
    category: 'General',
    unit: 'piece',
    quantityInStock: 10,
    buyPrice: 5,
    sellPrice: 8,
    minimumStockAlert: 0,
    dateAdded: now,
    lastUpdated: now,
    status: 'active',
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<Settings> = {}): Settings {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    id: 'app-settings',
    storeName: 'Test Store',
    cashierName: 'Cashier',
    currency: 'ILS',
    allowLossSale: false,
    nextBillSequence: 1,
    nextPurchaseSequence: 1,
    lowStockHighlight: true,
    lowStockThreshold: 5,
    taxMode: 'none',
    enableCash: true,
    enableCard: true,
    enableCredit: true,
    requireShift: false,
    createdAt: now,
    updatedAt: now,
    syncStatus: 'synced',
    ...overrides,
  };
}

export function makeAppUser(overrides: Partial<AppUser> = {}): AppUser {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    uid: 'user-1',
    email: 'cashier@example.test',
    name: 'Cashier',
    role: 'cashier',
    isActive: true,
    pendingApproval: false,
    createdAt: now,
    ...overrides,
  };
}

export function makeBillDraftItem(
  product: Product = makeProduct(),
  overrides: Partial<BillDraftItem> = {},
): BillDraftItem {
  return {
    productId: product.id,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    itemKind: 'product',
    availableStock: product.quantityInStock,
    quantity: 1,
    unitBuyPrice: product.buyPrice,
    unitSellPrice: product.sellPrice,
    ...overrides,
  };
}

export function makeBillForm(overrides: Partial<BillFormValues> = {}): BillFormValues {
  return {
    cashierName: 'Cashier',
    customerName: '',
    customerPhone: '',
    paymentMethod: 'cash',
    discountAmount: 0,
    taxAmount: 0,
    paidAmount: 8,
    notes: '',
    ...overrides,
  };
}

export function makePurchaseDraftItem(
  product: Product = makeProduct(),
  overrides: Partial<PurchaseDraftItem> = {},
): PurchaseDraftItem {
  return {
    productId: product.id,
    barcode: product.barcode,
    name: product.name,
    category: product.category,
    itemKind: 'product',
    currentStock: product.quantityInStock,
    quantity: 1,
    unitCost: product.buyPrice,
    unitSellPriceBefore: product.sellPrice,
    ...overrides,
  };
}

export function makePurchaseForm(overrides: Partial<PurchaseFormValues> = {}): PurchaseFormValues {
  return {
    cashierName: 'Cashier',
    supplierName: '',
    supplierPhone: '',
    supplierInvoiceNumber: '',
    invoiceDate: '',
    paymentDueDate: '',
    paymentMethod: 'cash',
    discountAmount: 0,
    taxAmount: 0,
    paidAmount: 5,
    notes: '',
    ...overrides,
  };
}
