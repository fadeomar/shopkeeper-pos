'use client';

import { ReceiptText } from 'lucide-react';
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
        icon={<ReceiptText size={24} aria-hidden />}
      />
      <BillsTable />
    </PageShell>
  );
}
