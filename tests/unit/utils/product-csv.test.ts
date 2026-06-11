import { describe, expect, it } from 'vitest';
import { createProductImportTemplateCsv, parseCsv, productsToCsv, stringifyCsv } from '@/lib/utils/product-csv';
import { makeProduct } from '@/tests/helpers/builders';

describe('product CSV utilities', () => {
  it('round-trips commas, quotes, newlines, and Arabic text safely', () => {
    const rows = [
      ['barcode', 'name', 'notes'],
      [' 123 ', 'حليب, أطفال', 'Line one\nLine "two"'],
    ];

    const csv = stringifyCsv(rows);

    expect(csv).toContain('"حليب, أطفال"');
    expect(csv).toContain('"Line one\nLine ""two"""');
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('strips a UTF-8 BOM and ignores empty trailing rows while parsing imports', () => {
    const csv = '\uFEFFbarcode,name,sellPrice\r\n123,Milk,5\r\n\r\n';

    expect(parseCsv(csv)).toEqual([
      ['barcode', 'name', 'sellPrice'],
      ['123', 'Milk', '5'],
    ]);
  });

  it('exports products with the template headers in a stable order', () => {
    const product = makeProduct({
      barcode: '7290000000011',
      name: 'Tahini, premium',
      notes: 'Shelf "A"',
      supplierName: 'Main Supplier',
      status: 'inactive',
    });

    const csv = productsToCsv([product]);
    const rows = parseCsv(csv);

    expect(rows[0]).toEqual([
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
    ]);
    expect(rows[1][0]).toBe('7290000000011');
    expect(rows[1][1]).toBe('Tahini, premium');
    expect(rows[1][12]).toBe('Shelf "A"');
    expect(rows[1][13]).toBe('inactive');
  });

  it('generates a product import template that can be parsed back by the CSV parser', () => {
    const rows = parseCsv(createProductImportTemplateCsv());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('barcode');
    expect(rows[0]).toContain('sellPrice');
    expect(rows[1][1]).toBe('Sample product');
  });
});
