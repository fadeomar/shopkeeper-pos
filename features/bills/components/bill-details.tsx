'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { formatCurrency } from '@/lib/utils/money';
import { formatDateTime } from '@/lib/utils/date';
import { EmptyState } from '@/components/ui/empty-state';
import { Card } from '@/components/ui/card';
import { useLocale } from '@/components/providers/locale-context';
import clsx from 'clsx';

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className={`text-sm ${highlight ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${highlight ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{value}</span>
    </div>
  );
}

export function BillDetails({ billId }: { billId: string }) {
  const { t } = useLocale();
  const bill    = useLiveQuery(() => db.bills.get(billId), [billId]);
  const items   = useLiveQuery(() => db.billItems.where('billId').equals(billId).toArray(), [billId]);
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? 'USD';

  if (bill === undefined || items === undefined) {
    return <Card><p className="text-sm text-slate-500">{t('bills.loadingBill')}</p></Card>;
  }
  if (!bill) {
    return <EmptyState title={t('bills.billNotFound')} description={t('bills.billNotFoundDesc')} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header card */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-slate-900">{bill.billNumber}</h2>
          <span className={clsx(
            'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold',
            bill.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700',
          )}>
            {t(`common.${bill.status}` as Parameters<typeof t>[0])}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <DetailField label={t('bills.createdAt')}  value={formatDateTime(bill.createdAt)} />
          <DetailField label={t('bills.customer')}   value={bill.customerName || t('common.walkin')} />
          <DetailField label={t('bills.cashier')}    value={bill.cashierName || '—'} />
          <DetailField label={t('bills.payment')}    value={t(`common.${bill.paymentMethod}` as Parameters<typeof t>[0])} />
          <DetailField label={t('bills.phone')}      value={bill.customerPhone || '—'} />
        </div>
      </Card>

      {/* Line items */}
      <Card padding="sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-slate-200">
                {[t('bills.barcodeAtSale'), t('bills.productAtSale'), t('bills.categoryAtSale'),
                  t('billing.qty'), t('bills.buy'), t('bills.sell'), t('bills.lineTotal'), t('bills.lineProfit')]
                  .map((h) => (
                    <th key={h} className="px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-3 py-2.5 text-slate-600 tabular-nums font-mono text-xs">{item.barcodeAtSale}</td>
                  <td className="px-3 py-2.5 font-medium text-slate-800">{item.productNameAtSale}</td>
                  <td className="px-3 py-2.5 text-slate-600">{item.categoryAtSale}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">{item.quantitySold}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatCurrency(item.unitBuyPriceAtSale, currency)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-slate-700">{formatCurrency(item.unitSellPriceAtSale, currency)}</td>
                  <td className="px-3 py-2.5 tabular-nums font-semibold text-slate-800">{formatCurrency(item.lineSubtotal, currency)}</td>
                  <td className="px-3 py-2.5 tabular-nums text-green-600 font-medium">{formatCurrency(item.lineProfit, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Totals */}
      <Card>
        <div className="max-w-xs ms-auto">
          <SummaryRow label={t('bills.subtotal')}    value={formatCurrency(bill.subtotal, currency)} />
          <SummaryRow label={t('bills.discount')}    value={formatCurrency(bill.discountAmount, currency)} />
          <SummaryRow label={t('bills.tax')}         value={formatCurrency(bill.taxAmount, currency)} />
          <SummaryRow label={t('bills.total')}       value={formatCurrency(bill.totalAmount, currency)} highlight />
          <SummaryRow label={t('bills.paid')}        value={formatCurrency(bill.paidAmount, currency)} />
          <SummaryRow label={t('bills.change')}      value={formatCurrency(bill.changeAmount, currency)} />
          <SummaryRow label={t('bills.totalProfit')} value={formatCurrency(bill.totalProfit, currency)} highlight />
        </div>
        {bill.notes && (
          <p className="mt-4 pt-4 border-t border-slate-100 text-sm text-slate-500">
            <span className="font-medium text-slate-700">{t('bills.notes')}:</span> {bill.notes}
          </p>
        )}
      </Card>
    </div>
  );
}
