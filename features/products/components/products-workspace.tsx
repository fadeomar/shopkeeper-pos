'use client';

import { useState } from 'react';
import type { Product } from '@/types/domain';
import { ProductForm } from './product-form';
import { ProductsTable } from './products-table';
import { ProductImportExport } from './product-import-export';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/components/providers/locale-context';

export function ProductsWorkspace() {
  const { t } = useLocale();
  const [selectedProduct, setSelectedProduct] = useState<Product | undefined>();

  return (
    <div className="flex flex-col gap-5">
      <ProductImportExport />
      <Card>
        <h3 className="text-base font-semibold text-slate-800 mb-4">
          {selectedProduct
            ? `${t('products.editProduct')}: ${selectedProduct.name}`
            : t('products.addProduct')}
        </h3>
        <ProductForm product={selectedProduct} onSaved={() => setSelectedProduct(undefined)} />
      </Card>
      <ProductsTable onEdit={setSelectedProduct} />
    </div>
  );
}
