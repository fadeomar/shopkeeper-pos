'use client';

import Link from 'next/link';
import { use } from 'react';
import { BillDetails } from '@/features/bills/components/bill-details';
import { useLocale } from '@/components/providers/locale-context';

export default function BillDetailsPage({ params }: { params: Promise<{ billId: string }> }) {
  const { billId } = use(params);
  const { t, dir } = useLocale();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/bills"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          {dir === 'rtl' ? '→' : '←'} {t('bills.backToBills')}
        </Link>
      </div>
      <BillDetails billId={billId} />
    </div>
  );
}
