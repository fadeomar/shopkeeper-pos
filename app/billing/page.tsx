'use client';

import { PosScreen } from '@/features/bills/components/pos-screen';
import { useLocale } from '@/components/providers/locale-context';

export default function BillingPage() {
  const { t } = useLocale();
  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="text-xl font-bold text-slate-900">{t('billing.title')}</h2>
        <p className="mt-1 text-sm text-slate-500">{t('billing.subtitle')}</p>
      </section>
      <PosScreen />
    </div>
  );
}
