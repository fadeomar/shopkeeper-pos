'use client';

import { ProductsWorkspace } from '@/features/products/components/products-workspace';
import { useLocale } from '@/components/providers/locale-context';

export default function ProductsPage() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xl font-bold text-slate-900">{t('products.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('products.subtitle')}</p>
      </section>
      <ProductsWorkspace />
    </div>
  );
}
