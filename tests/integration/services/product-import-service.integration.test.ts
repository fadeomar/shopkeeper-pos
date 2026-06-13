import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getSyncQueueId } from '@/lib/services/sync-queue-service';
import { resetTestDb, seedProduct } from '@/tests/helpers/db';

vi.mock('@/lib/services/subscription-service', () => ({
  assertSubscriptionCanWrite: vi.fn().mockResolvedValue(undefined),
}));

const { importProductsFromPreview, previewProductCsvImport } = await import('@/lib/services/product-import-service');

async function expectAppError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('product-import-service integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDb();
  });

  it('returns a readable preview error for empty files and missing required headers', async () => {
    await expect(previewProductCsvImport('')).resolves.toMatchObject({
      totalRows: 0,
      validRows: [],
      errors: [{ rowNumber: 0, message: 'CSV file is empty.' }],
    });

    await expect(previewProductCsvImport('barcode,name\n123,Milk')).resolves.toMatchObject({
      totalRows: 1,
      validRows: [],
      errors: [{ rowNumber: 0, message: 'CSV must include barcode, name, and sellPrice columns.' }],
    });
  });

  it('normalizes imported rows, supports aliased headers, and reports validation errors by row number', async () => {
    const csv = [
      'SKU,Product Name,Category,Qty,Cost,Price,Min Stock,Supplier,Unit,Status',
      ' 729 000 000 0011 , حليب أطفال , Baby, 3, 4.25, 7.5, 1, مورد رئيسي, box, inactive',
      '7290000000012, A, General, -1, 1, 2, 0, Supplier, pcs, active',
    ].join('\n');

    const preview = await previewProductCsvImport(csv);

    expect(preview.totalRows).toBe(2);
    expect(preview.validRows).toHaveLength(1);
    expect(preview.validRows[0]).toMatchObject({
      rowNumber: 2,
      values: {
        barcode: '7290000000011',
        name: 'حليب أطفال',
        category: 'Baby',
        quantityInStock: 3,
        buyPrice: 4.25,
        sellPrice: 7.5,
        minimumStockAlert: 1,
        supplierName: 'مورد رئيسي',
        unit: 'box',
        status: 'inactive',
      },
    });
    expect(preview.errors).toEqual([
      expect.objectContaining({ rowNumber: 3, barcode: '7290000000012' }),
    ]);
    expect(preview.errors[0].message).toContain('Product name is required');
    expect(preview.errors[0].message).toContain('Quantity cannot be negative');
  });

  it('blocks duplicate barcodes inside the CSV and barcodes already in inventory', async () => {
    await seedProduct({ id: 'existing-product', barcode: '7290000000099' });
    const csv = [
      'barcode,name,sellPrice,quantityInStock,buyPrice',
      '7290000000099,Existing Milk,5,1,2',
      '7290000000088,Duplicate One,5,1,2',
      '729 000 000 0088,Duplicate Two,6,1,2',
      '7290000000077,Valid Product,7,1,2',
    ].join('\n');

    const preview = await previewProductCsvImport(csv);

    expect(preview.existingBarcodes).toEqual(['7290000000099']);
    expect(preview.duplicateBarcodes).toEqual(['7290000000088']);
    expect(preview.validRows.map((row) => row.values.barcode)).toEqual(['7290000000077']);
    expect(preview.errors).toEqual([
      expect.objectContaining({ rowNumber: 2, barcode: '7290000000099', message: 'A product with this barcode already exists.' }),
      expect.objectContaining({ rowNumber: 3, barcode: '7290000000088', message: 'Duplicate barcode inside this CSV file.' }),
      expect.objectContaining({ rowNumber: 4, barcode: '7290000000088', message: 'Duplicate barcode inside this CSV file.' }),
    ]);
  });

  it('imports valid preview rows, creates initial stock movements, queues sync, and requests background sync', async () => {
    const syncRequested = vi.fn();
    window.addEventListener('shopkeeper:sync-requested', syncRequested);
    const preview = await previewProductCsvImport([
      'barcode,name,category,quantityInStock,buyPrice,sellPrice,minimumStockAlert',
      '7290000000101,Rice,Food,10,3.25,5,2',
      '7290000000102,Gift Card,General,0,0,25,0',
    ].join('\n'));

    const result = await importProductsFromPreview(preview);

    expect(result).toEqual({ importedCount: 2, movementCount: 1 });
    await expect(db.products.count()).resolves.toBe(2);
    const importedProducts = await db.products.orderBy('barcode').toArray();
    expect(importedProducts.map((product) => [product.barcode, product.syncStatus])).toEqual([
      ['7290000000101', 'pending'],
      ['7290000000102', 'pending'],
    ]);

    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: importedProducts[0].id,
      movementType: 'initial',
      quantityChange: 10,
      referenceType: 'product',
      referenceId: importedProducts[0].id,
      syncStatus: 'pending',
    });

    await expect(db.syncQueue.get(getSyncQueueId('product', importedProducts[0].id))).resolves.toMatchObject({
      entity: 'product',
      operation: 'create',
      status: 'pending',
    });
    await expect(db.syncQueue.get(getSyncQueueId('stockMovement', movements[0].id))).resolves.toMatchObject({
      entity: 'stockMovement',
      operation: 'create',
      status: 'pending',
    });
    expect(syncRequested).toHaveBeenCalledTimes(1);
  });

  it('rechecks existing barcodes at import time to avoid race-condition duplicates', async () => {
    const preview = await previewProductCsvImport('barcode,name,sellPrice\n7290000000201,Race Product,4');
    await seedProduct({ id: 'race-product', barcode: '7290000000201' });

    await expectAppError(importProductsFromPreview(preview), AppErrorCode.IMPORT_DUPLICATES);
    await expect(db.products.count()).resolves.toBe(1);
    await expect(db.stockMovements.count()).resolves.toBe(0);
    await expect(db.syncQueue.count()).resolves.toBe(0);
  });

  it('no-ops cleanly when a preview has no valid rows', async () => {
    const result = await importProductsFromPreview({
      totalRows: 1,
      validRows: [],
      errors: [{ rowNumber: 2, message: 'bad row' }],
      duplicateBarcodes: [],
      existingBarcodes: [],
    });

    expect(result).toEqual({ importedCount: 0, movementCount: 0 });
    await expect(db.products.count()).resolves.toBe(0);
  });
});
