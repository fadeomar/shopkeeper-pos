import type { Product } from '@/types/domain';

export const PRODUCT_CSV_HEADERS = [
  'barcode',
  'name',
  'category',
  'quantityInStock',
  'buyPrice',
  'sellPrice',
  'minimumStockAlert',
  'supplierName',
  'brand',
  'unit',
  'expiryDate',
  'shelfLocation',
  'notes',
  'status',
  'dateAdded',
] as const;

export type ProductCsvHeader = (typeof PRODUCT_CSV_HEADERS)[number];

function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function stringifyCsv(rows: Array<Array<string | number | boolean | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n');
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);

  return rows;
}

export function createProductImportTemplateCsv(): string {
  return stringifyCsv([
    [...PRODUCT_CSV_HEADERS],
    [
      '1234567890123',
      'Sample product',
      'General',
      10,
      1.25,
      2.5,
      3,
      'Sample supplier',
      'Sample brand',
      'pcs',
      '',
      'A1',
      'Optional note',
      'active',
      new Date().toISOString().slice(0, 10),
    ],
  ]);
}

export function productsToCsv(products: Product[]): string {
  const rows = products.map((product) => [
    product.barcode,
    product.name,
    product.category,
    product.quantityInStock,
    product.buyPrice,
    product.sellPrice,
    product.minimumStockAlert,
    product.supplierName ?? '',
    product.brand ?? '',
    product.unit,
    product.expiryDate ?? '',
    product.shelfLocation ?? '',
    product.notes ?? '',
    product.status,
    product.dateAdded,
  ]);

  return stringifyCsv([[...PRODUCT_CSV_HEADERS], ...rows]);
}
