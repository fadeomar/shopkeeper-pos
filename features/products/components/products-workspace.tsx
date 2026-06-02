'use client';

import { useEffect, useRef, useState } from 'react';
import type { Product } from '@/types/domain';
import { ProductForm } from './product-form';
import { ProductsTable } from './products-table';
import { ProductImportExport } from './product-import-export';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/components/providers/locale-context';

export function ProductsWorkspace() {
  const { t } = useLocale();
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();
  const formRef = useRef<HTMLDivElement | null>(null);

  // The edit form sits above the product list. On mobile, tapping Edit on a
  // card far down the list would otherwise update the off-screen form with no
  // visible feedback — scroll it into view so the cashier sees the prefilled
  // form. requestAnimationFrame waits for the form to re-render with the
  // selected product before scrolling. Harmless on desktop (form is near top).
  useEffect(() => {
    if (!selectedProduct) return;
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [selectedProduct]);

  return (
    <div className="flex flex-col gap-5">
      <ProductImportExport />
      <div ref={formRef} className="scroll-mt-4">
        <Card>
          <h3 className="text-base font-semibold text-slate-800 mb-4">
            {selectedProduct
              ? `${t('products.editProduct')}: ${selectedProduct.name}`
              : t('products.addProduct')}
          </h3>
          <ProductForm
            product={selectedProduct}
            onSaved={() => setSelectedProduct(undefined)}
            onCancel={
              selectedProduct ? () => setSelectedProduct(undefined) : undefined
            }
            onOpenExisting={setSelectedProduct}
          />
        </Card>
      </div>
      <ProductsTable onEdit={setSelectedProduct} />
    </div>
  );
}
