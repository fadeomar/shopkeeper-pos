'use client';

import { Package } from 'lucide-react';
import { ProductsWorkspace } from '@/features/products/components/products-workspace';
import { useLocale } from '@/components/providers/locale-context';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';

export default function ProductsPage() {
  const { t } = useLocale();
  return (
    <PageShell>
      <PageHeader
        title={t('products.title')}
        description={t('products.subtitle')}
        icon={<Package size={24} aria-hidden />}
      />
      <ProductsWorkspace />
    </PageShell>
  );
}
