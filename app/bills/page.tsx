'use client';

import { BillsTable } from '@/features/bills/components/bills-table';
import { useLocale } from '@/components/providers/locale-context';

export default function BillsPage() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xl font-bold text-slate-900">{t('bills.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('bills.subtitle')}</p>
      </section>
      <BillsTable />
    </div>
  );
}
