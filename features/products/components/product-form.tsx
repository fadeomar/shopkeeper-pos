'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { productSchema, type ProductSchema } from '@/features/products/schema';
import { db } from '@/lib/db/schema';
import { productRepo } from '@/lib/db/repositories';
import { createProductWithInitialMovement, updateProductDetails } from '@/lib/services/inventory-service';
import { createId } from '@/lib/utils/id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { BarcodeScannerModal } from '@/components/barcode/barcode-scanner-modal';
import { useLocale } from '@/components/providers/locale-context';
import { enqueueSyncJob } from '@/lib/services/sync-queue-service';
import type { Product } from '@/types/domain';
import clsx from 'clsx';

interface Props { product?: Product; onSaved?: () => void }

const emptyDefaults: ProductSchema = {
  barcode: '', name: '', category: '', brand: '', unit: 'pcs',
  quantityInStock: 0, buyPrice: 0, sellPrice: 0, minimumStockAlert: 0,
  supplierName: '', dateAdded: new Date().toISOString().slice(0, 10),
  expiryDate: '', shelfLocation: '', notes: '', status: 'active',
};

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="text-xs text-red-600 font-medium">{error}</span>}
    </label>
  );
}

export function ProductForm({ product, onSaved }: Props) {
  const { t } = useLocale();
  const { push } = useToast();
  const [lossWarning,  setLossWarning]  = useState(false);
  const [scannerOpen,  setScannerOpen]  = useState(false);

  const form = useForm<ProductSchema>({
    resolver: zodResolver(productSchema),
    defaultValues: product ?? emptyDefaults,
  });

  const sellPrice = form.watch('sellPrice');
  const buyPrice  = form.watch('buyPrice');

  useEffect(() => { form.reset(product ?? emptyDefaults); }, [form, product]);
  useEffect(() => { setLossWarning(Number(sellPrice) < Number(buyPrice)); }, [sellPrice, buyPrice]);

  async function onSubmit(values: ProductSchema) {
    const existing = await productRepo.findByBarcode(values.barcode);
    if (existing && existing.id !== product?.id) {
      push(t('products.barcodeUnique'), 'error');
      return;
    }
    const now = new Date().toISOString();
    if (product) {
      await updateProductDetails(product, { ...values, quantityInStock: product.quantityInStock, lastUpdated: now });
      await db.products.update(product.id, { syncStatus: 'pending' });
      void enqueueSyncJob({ entity: 'product', entityId: product.id, operation: 'update' });
      push(t('products.productUpdated'));
    } else {
      const created: Product = { id: createId('prod'), ...values, lastUpdated: now, syncStatus: 'pending' };
      await createProductWithInitialMovement(created);
      void enqueueSyncJob({ entity: 'product', entityId: created.id, operation: 'create' });
      form.reset(emptyDefaults);
      push(t('products.productCreated'));
    }
    onSaved?.();
  }

  const e = form.formState.errors;

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label={t('products.name')} error={e.name?.message}>
          <Input {...form.register('name')} />
        </FormField>

        <FormField label={t('products.barcode')} error={e.barcode?.message}>
          <div className="flex gap-2">
            <Input {...form.register('barcode')} className="flex-1" />
            <Button type="button" variant="secondary" onClick={() => setScannerOpen(true)}>
              {t('common.scan')}
            </Button>
          </div>
        </FormField>

        <FormField label={t('products.category')}>
          <Input {...form.register('category')} />
        </FormField>

        <FormField label={t('products.brand')}>
          <Input {...form.register('brand')} />
        </FormField>

        <FormField label={t('products.unit')}>
          <Input {...form.register('unit')} />
        </FormField>

        <FormField
          label={t('products.quantityInStock')}
          error={product ? t('products.stockEditNote') : undefined}
        >
          <Input
            type="number" step="1"
            {...form.register('quantityInStock')}
            disabled={Boolean(product)}
            className={clsx(Boolean(product) && 'opacity-50')}
          />
        </FormField>

        <FormField label={t('products.buyPrice')}>
          <Input type="number" step="0.01" {...form.register('buyPrice')} />
        </FormField>

        <FormField label={t('products.sellPrice')}>
          <Input type="number" step="0.01" {...form.register('sellPrice')} />
        </FormField>

        <FormField label={t('products.minimumStockAlert')}>
          <Input type="number" step="1" {...form.register('minimumStockAlert')} />
        </FormField>

        <FormField label={t('products.supplierName')}>
          <Input {...form.register('supplierName')} />
        </FormField>

        <FormField label={t('products.dateAdded')}>
          <Input type="date" {...form.register('dateAdded')} />
        </FormField>

        <FormField label={t('products.expiryDate')}>
          <Input type="date" {...form.register('expiryDate')} />
        </FormField>

        <FormField label={t('products.shelfLocation')}>
          <Input {...form.register('shelfLocation')} />
        </FormField>

        <FormField label={t('products.status')}>
          <Select {...form.register('status')}>
            <option value="active">{t('common.active')}</option>
            <option value="inactive">{t('common.inactive')}</option>
          </Select>
        </FormField>

        <FormField label={t('products.notes')} >
          <Input {...form.register('notes')} />
        </FormField>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-slate-100">
        <p className={clsx('text-sm', lossWarning ? 'text-amber-600 font-semibold' : 'text-slate-400')}>
          {lossWarning ? t('products.lossWarning') : t('products.editNote')}
        </p>
        <Button type="submit">
          {product ? t('products.saveProduct') : t('products.addProduct')}
        </Button>
      </div>

      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={t('products.scanBarcode')}
        description={t('products.scanBarcodeDesc')}
        onDetected={(barcode) => {
          form.setValue('barcode', barcode, { shouldDirty: true, shouldValidate: true });
          setScannerOpen(false);
        }}
      />
    </form>
  );
}
