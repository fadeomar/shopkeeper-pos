import { productSchema, type ProductSchema } from '@/features/products/schema';
import { db } from '@/lib/db/schema';
import { buildSyncQueueItem } from '@/lib/services/sync-queue-service';
import { createId } from '@/lib/utils/id';
import { nowIso } from '@/lib/utils/date';
import { parseCsv } from '@/lib/utils/product-csv';
import type { Product, StockMovement } from '@/types/domain';

export interface ProductImportError {
  rowNumber: number;
  barcode?: string;
  message: string;
}

export interface ProductImportValidRow {
  rowNumber: number;
  values: ProductSchema;
}

export interface ProductImportPreview {
  totalRows: number;
  validRows: ProductImportValidRow[];
  errors: ProductImportError[];
  duplicateBarcodes: string[];
  existingBarcodes: string[];
}

export interface ProductImportResult {
  importedCount: number;
  movementCount: number;
}

type ProductField = keyof ProductSchema;

type HeaderMap = Map<string, number>;

const FIELD_ALIASES: Record<ProductField, string[]> = {
  barcode: ['barcode', 'bar code', 'sku'],
  name: ['name', 'product name', 'product'],
  category: ['category', 'cat'],
  brand: ['brand'],
  unit: ['unit', 'uom'],
  quantityInStock: ['quantityinstock', 'quantity in stock', 'quantity', 'qty', 'stock'],
  buyPrice: ['buyprice', 'buy price', 'cost', 'cost price', 'purchase price'],
  sellPrice: ['sellprice', 'sell price', 'sale price', 'price', 'retail price'],
  minimumStockAlert: ['minimumstockalert', 'minimum stock alert', 'minimum stock', 'min stock', 'min'],
  supplierName: ['suppliername', 'supplier name', 'supplier'],
  dateAdded: ['dateadded', 'date added', 'created date'],
  expiryDate: ['expirydate', 'expiry date', 'expiration date', 'expires'],
  shelfLocation: ['shelflocation', 'shelf location', 'location', 'shelf'],
  notes: ['notes', 'note'],
  status: ['status'],
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}

function compactHeader(value: string): string {
  return normalizeHeader(value).replace(/\s+/g, '');
}

function buildHeaderMap(headers: string[]): HeaderMap {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    map.set(normalizeHeader(header), index);
    map.set(compactHeader(header), index);
  });
  return map;
}

function getCell(row: string[], headers: HeaderMap, field: ProductField): string {
  const aliases = FIELD_ALIASES[field];
  for (const alias of aliases) {
    const index = headers.get(normalizeHeader(alias)) ?? headers.get(compactHeader(alias));
    if (typeof index === 'number') return (row[index] ?? '').trim();
  }
  return '';
}

function numberOrDefault(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const normalized = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)
    ? trimmed.replace(/,/g, '')
    : trimmed;
  return Number(normalized);
}

function statusOrDefault(value: string): ProductSchema['status'] {
  return value.trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function rowToProductValues(row: string[], headers: HeaderMap): ProductSchema {
  return {
    barcode: getCell(row, headers, 'barcode'),
    name: getCell(row, headers, 'name'),
    category: getCell(row, headers, 'category') || 'General',
    brand: getCell(row, headers, 'brand'),
    unit: getCell(row, headers, 'unit') || 'pcs',
    quantityInStock: numberOrDefault(getCell(row, headers, 'quantityInStock'), 0),
    buyPrice: numberOrDefault(getCell(row, headers, 'buyPrice'), 0),
    sellPrice: numberOrDefault(getCell(row, headers, 'sellPrice'), 0),
    minimumStockAlert: numberOrDefault(getCell(row, headers, 'minimumStockAlert'), 0),
    supplierName: getCell(row, headers, 'supplierName'),
    dateAdded: getCell(row, headers, 'dateAdded') || new Date().toISOString().slice(0, 10),
    expiryDate: getCell(row, headers, 'expiryDate'),
    shelfLocation: getCell(row, headers, 'shelfLocation'),
    notes: getCell(row, headers, 'notes'),
    status: statusOrDefault(getCell(row, headers, 'status')),
  };
}

function requestSync(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('shopkeeper:sync-requested'));
  }
}

export async function previewProductCsvImport(text: string): Promise<ProductImportPreview> {
  const rows = parseCsv(text);
  if (rows.length === 0) {
    return {
      totalRows: 0,
      validRows: [],
      errors: [{ rowNumber: 0, message: 'CSV file is empty.' }],
      duplicateBarcodes: [],
      existingBarcodes: [],
    };
  }

  const [headersRow, ...bodyRows] = rows;
  const headers = buildHeaderMap(headersRow);
  const errors: ProductImportError[] = [];
  const parsedRows: ProductImportValidRow[] = [];

  const hasBarcode = FIELD_ALIASES.barcode.some((alias) => headers.has(normalizeHeader(alias)) || headers.has(compactHeader(alias)));
  const hasName = FIELD_ALIASES.name.some((alias) => headers.has(normalizeHeader(alias)) || headers.has(compactHeader(alias)));
  const hasSellPrice = FIELD_ALIASES.sellPrice.some((alias) => headers.has(normalizeHeader(alias)) || headers.has(compactHeader(alias)));

  if (!hasBarcode || !hasName || !hasSellPrice) {
    return {
      totalRows: bodyRows.length,
      validRows: [],
      errors: [{ rowNumber: 0, message: 'CSV must include barcode, name, and sellPrice columns.' }],
      duplicateBarcodes: [],
      existingBarcodes: [],
    };
  }

  bodyRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const parsed = productSchema.safeParse(rowToProductValues(row, headers));
    if (!parsed.success) {
      errors.push({
        rowNumber,
        barcode: getCell(row, headers, 'barcode'),
        message: parsed.error.issues.map((issue) => issue.message).join('; '),
      });
      return;
    }

    parsedRows.push({ rowNumber, values: parsed.data });
  });

  const barcodeRows = new Map<string, ProductImportValidRow[]>();
  parsedRows.forEach((row) => {
    const barcode = row.values.barcode.trim();
    barcodeRows.set(barcode, [...(barcodeRows.get(barcode) ?? []), row]);
  });

  const duplicateBarcodes = Array.from(barcodeRows.entries())
    .filter(([, matchingRows]) => matchingRows.length > 1)
    .map(([barcode]) => barcode);
  const duplicateSet = new Set(duplicateBarcodes);

  duplicateBarcodes.forEach((barcode) => {
    barcodeRows.get(barcode)?.forEach((row) => {
      errors.push({ rowNumber: row.rowNumber, barcode, message: 'Duplicate barcode inside this CSV file.' });
    });
  });

  const uniqueBarcodes = Array.from(barcodeRows.keys()).filter((barcode) => !duplicateSet.has(barcode));
  const existingProducts = uniqueBarcodes.length
    ? await db.products.where('barcode').anyOf(uniqueBarcodes).toArray()
    : [];
  const existingBarcodes = existingProducts.map((product) => product.barcode);
  const existingSet = new Set(existingBarcodes);

  parsedRows.forEach((row) => {
    if (existingSet.has(row.values.barcode)) {
      errors.push({ rowNumber: row.rowNumber, barcode: row.values.barcode, message: 'A product with this barcode already exists.' });
    }
  });

  const validRows = parsedRows.filter((row) => !duplicateSet.has(row.values.barcode) && !existingSet.has(row.values.barcode));

  return {
    totalRows: bodyRows.length,
    validRows,
    errors: errors.sort((a, b) => a.rowNumber - b.rowNumber),
    duplicateBarcodes,
    existingBarcodes,
  };
}

export async function importProductsFromPreview(preview: ProductImportPreview): Promise<ProductImportResult> {
  if (preview.validRows.length === 0) return { importedCount: 0, movementCount: 0 };

  const now = nowIso();
  const products: Product[] = preview.validRows.map(({ values }) => ({
    id: createId('prod'),
    ...values,
    lastUpdated: now,
    syncStatus: 'pending',
    syncedAt: undefined,
    lastSyncError: undefined,
  }));

  const movements: StockMovement[] = products
    .filter((product) => product.quantityInStock > 0)
    .map((product) => ({
      id: createId('move'),
      productId: product.id,
      movementType: 'initial',
      quantityChange: product.quantityInStock,
      referenceType: 'product',
      referenceId: product.id,
      note: 'Initial stock from product CSV import',
      createdAt: now,
      syncStatus: 'pending',
    }));

  await db.transaction('rw', db.products, db.stockMovements, db.syncQueue, async () => {
    const existing = await db.products.where('barcode').anyOf(products.map((product) => product.barcode)).count();
    if (existing > 0) {
      throw new Error('Some products already exist. Preview the CSV again and retry.');
    }

    await db.products.bulkAdd(products);
    if (movements.length > 0) await db.stockMovements.bulkAdd(movements);
    await db.syncQueue.bulkPut([
      ...products.map((product) => buildSyncQueueItem({ entity: 'product', entityId: product.id, operation: 'create' })),
      ...movements.map((movement) => buildSyncQueueItem({ entity: 'stockMovement', entityId: movement.id, operation: 'create' })),
    ]);
  });

  requestSync();

  return { importedCount: products.length, movementCount: movements.length };
}
