'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { formatDateTime } from '@/lib/utils/date';
import { formatCurrency } from '@/lib/utils/money';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/components/providers/locale-context';
import clsx from 'clsx';
import type { SyncStatus } from '@/types/domain';

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  if (!status || status === 'synced') return <span className="text-slate-300">—</span>;
  const styles: Record<Exclude<SyncStatus, 'synced'>, string> = {
    pending: 'bg-amber-100 text-amber-700',
    syncing: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', styles[status])}>
      {t(`sync.${status}`)}
    </span>
  );
}

export function BillsTable() {
  const { t } = useLocale();
  const bills = useLiveQuery(() => db.bills.orderBy('createdAt').reverse().toArray(), []);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? 'USD';

  if (!bills) return <Card><p className="text-sm text-slate-500">{t('bills.loadingBills')}</p></Card>;
  if (bills.length === 0) {
    return <EmptyState title={t('bills.noBills')} description={t('bills.noBillsDesc')} />;
  }

  const headers = [
    t('bills.billNumber'), t('bills.dateTime'), t('bills.customer'), t('bills.cashier'),
    t('bills.itemCount'), t('bills.total'), t('bills.profit'), t('bills.payment'),
    t('bills.status'), t('sync.status'), t('bills.action'),
  ];

  return (
    <Card padding="sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="border-b border-slate-200">
              {headers.map((h) => (
                <th key={h} className="px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bills.map((bill) => (
              <tr key={bill.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-3 py-3 font-medium text-slate-800 tabular-nums">{bill.billNumber}</td>
                <td className="px-3 py-3 text-slate-600 tabular-nums whitespace-nowrap">{formatDateTime(bill.createdAt)}</td>
                <td className="px-3 py-3 text-slate-700">{bill.customerName || t('common.walkin')}</td>
                <td className="px-3 py-3 text-slate-700">{bill.cashierName || '—'}</td>
                <td className="px-3 py-3 text-slate-700 tabular-nums">{bill.itemCount}</td>
                <td className="px-3 py-3 font-semibold text-slate-800 tabular-nums">{formatCurrency(bill.totalAmount, currency)}</td>
                <td className="px-3 py-3 text-green-600 font-medium tabular-nums">{formatCurrency(bill.totalProfit, currency)}</td>
                <td className="px-3 py-3">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                    {t(`common.${bill.paymentMethod}` as Parameters<typeof t>[0])}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <span className={clsx(
                    'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize',
                    bill.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
                  )}>
                    {t(`common.${bill.status}` as Parameters<typeof t>[0])}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <SyncBadge status={bill.syncStatus} />
                </td>
                <td className="px-3 py-3">
                  <Link
                    href={`/bills/${bill.id}`}
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors"
                  >
                    {t('bills.viewDetails')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
