'use client';

import { BillsTable } from '@/features/bills/components/bills-table';
import { useLocale } from '@/components/providers/locale-context';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';

export default function BillsPage() {
  const { t } = useLocale();
  return (
    <PageShell size="wide">
      <PageHeader
        title={t('bills.title')}
        description={t('bills.subtitle')}
      />
      <BillsTable />
    </PageShell>
  );
}
