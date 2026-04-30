export type Locale = 'en' | 'ar';
export type Direction = 'ltr' | 'rtl';

export interface TranslationDict {
  common: {
    save: string; cancel: string; close: string; edit: string; remove: string;
    add: string; search: string; loading: string; confirm: string; reset: string;
    scan: string; active: string; inactive: string; cash: string; card: string;
    mixed: string; credit: string; finalized: string; voided: string; walkin: string;
    back: string; adjust: string; deactivate: string; activate: string;
    saveAdjustment: string; cancel_: string;
  };
  nav: {
    dashboard: string; products: string; newBill: string;
    billHistory: string; settings: string;
  };
  sidebar: { title: string; subtitle: string };
  pwa: {
    online: string; offline: string; cacheReady: string;
    cachePrep: string; installed: string; installable: string;
    updateAvailable: string; reload: string;
  };
  db: {
    storageError: string; storageErrorDesc: string;
    timeoutError: string; initError: string; loading: string;
  };
  dashboard: {
    tagline: string; initDemo: string; createBill: string;
    liveProducts: string; lowStock: string; totalSales: string;
    inventoryCost: string; recentMovements: string;
    demoInserted: string; demoExists: string;
  };
  products: {
    title: string; subtitle: string; addProduct: string; editProduct: string;
    saveProduct: string; searchPlaceholder: string; allCategories: string;
    noProducts: string; noProductsDesc: string; loadingProducts: string;
    name: string; barcode: string; category: string; brand: string; unit: string;
    quantityInStock: string; buyPrice: string; sellPrice: string;
    minimumStockAlert: string; supplierName: string; dateAdded: string;
    expiryDate: string; shelfLocation: string; notes: string; status: string;
    shelf: string; qty: string; buy: string; sell: string; min: string;
    supplier: string; actions: string;
    stockAdjustTitle: string; stockAdjustDesc: string;
    quantityChange: string; reasonNote: string; currentStock: string;
    resultingStock: string; scanBarcode: string; scanBarcodeDesc: string;
    lossWarning: string; editNote: string; stockEditNote: string;
    barcodeUnique: string; productCreated: string; productUpdated: string;
    productDeactivated: string; productActivated: string;
    stockAdjusted: string; nonZeroAdj: string; adjustFailed: string;
  };
  billing: {
    title: string; subtitle: string; buildBill: string; billSummary: string;
    typeBarcode: string; selectProduct: string; addItem: string;
    noItems: string; noItemsDesc: string; loadingPos: string;
    product: string; stock: string; qty: string; sell: string;
    subtotalCol: string; profit: string; cashierName: string;
    customerName: string; customerPhone: string; paymentMethod: string;
    discount: string; tax: string; expectedPaid: string; actualPaid: string;
    notes: string; subtotal: string; total: string; totalProfit: string;
    change: string; paidBelowTotal: string; clearDraft: string;
    reviewFinalize: string; finalizeBill: string; finalizeDesc: string;
    items: string; paid: string; confirmSave: string; scanProduct: string;
    scanProductDesc: string; doneScanning: string; outOfStock: string;
    notFound: string; notFoundBarcode: string; addOneProduct: string;
    billCreated: string; billFailed: string; itemAdded: string; itemUpdated: string;
  };
  bills: {
    title: string; subtitle: string; noBills: string; noBillsDesc: string;
    loadingBills: string; billNumber: string; dateTime: string; customer: string;
    cashier: string; itemCount: string; total: string; profit: string;
    payment: string; status: string; action: string; viewDetails: string;
    loadingBill: string; billNotFound: string; billNotFoundDesc: string;
    createdAt: string; phone: string; barcodeAtSale: string;
    productAtSale: string; categoryAtSale: string; buy: string; sell: string;
    lineTotal: string; lineProfit: string; subtotal: string; discount: string;
    tax: string; paid: string; change: string; totalProfit: string; notes: string;
    backToBills: string;
  };
  settings: {
    title: string; subtitle: string; storeName: string; cashierName: string;
    currency: string; allowLossSale: string; lowStockHighlight: string;
    save: string; saved: string; language: string; languageDesc: string;
    english: string; arabic: string; about: string; version: string;
  };
  scanner: {
    requesting: string; denied: string; unsupported: string; http: string;
    error: string; starting: string; active: string; activeFrames: string;
    lastScanned: string; torchOn: string; torchOff: string;
    close: string; doneScan: string;
  };
}
