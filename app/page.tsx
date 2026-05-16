'use client';

import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { seedDemoData } from '@/lib/db/seed';
import { formatCurrency } from '@/lib/utils/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import { getBillNetTotal } from '@/features/bills/utils/bill-summary';
import { getSupplierLedger } from '@/lib/services/supplier-ledger-service';

export default function DashboardPage() {
  const { t } = useLocale();
  const products = useLiveQuery(() => db.products.toArray(), []);
  const bills = useLiveQuery(() => db.bills.toArray(), []);
  const stockMovements = useLiveQuery(
    () => db.stockMovements.orderBy('createdAt').reverse().limit(5).toArray(), [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const supplierLedger = useLiveQuery(() => getSupplierLedger(), []);
  const { push } = useToast();

  const liveProducts = products?.filter((p) => p.status === 'active') ?? [];
  const lowStockCount = liveProducts.filter((p) => p.quantityInStock <= p.minimumStockAlert).length;
  const totalInventoryValue = liveProducts.reduce((s, p) => s + p.quantityInStock * p.buyPrice, 0);
  // Use net total so voided bills contribute 0 and partial returns reduce the
  // figure correctly — matches what the bills page and reports already show.
  const totalSales = (bills ?? []).reduce((s, b) => s + getBillNetTotal(b), 0);
  // Sum of positive supplier balances — what we owe to all suppliers combined.
  // Negative balances (supplier credit / overpayments) aren't subtracted here
  // because they aren't liquid: we can't use a $20 credit at supplier A to
  // pay supplier B. They show up separately in the supplier ledger.
  const owedToSuppliers = (supplierLedger ?? []).reduce(
    (sum, row) => sum + Math.max(0, row.balanceOwed),
    0,
  );
  const currency = settings?.currency ?? 'USD';

  async function initializeDemo() {
    const result = await seedDemoData();
    push(result.inserted ? t('dashboard.demoInserted') : t('dashboard.demoExists'));
  }

  const stats = [
    { label: t('dashboard.liveProducts'),  value: liveProducts.length },
    { label: t('dashboard.lowStock'),      value: lowStockCount },
    { label: t('dashboard.totalSales'),    value: formatCurrency(totalSales, currency) },
    { label: t('dashboard.inventoryCost'), value: formatCurrency(totalInventoryValue, currency) },
    { label: t('dashboard.owedToSuppliers'), value: formatCurrency(owedToSuppliers, currency) },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {settings?.storeName ?? t('sidebar.subtitle')}
          </h2>
          <p className="mt-1 text-sm text-slate-500 max-w-xl">{t('dashboard.tagline')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={initializeDemo}>
            {t('dashboard.initDemo')}
          </Button>
          <Link
            href="/billing"
            className="inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-colors duration-150 px-4 py-2.5 text-sm min-h-[42px] bg-blue-600 text-white hover:bg-blue-700"
          >
            {t('dashboard.createBill')}
          </Link>
        </div>
      </section>

      {/* Stats grid */}
      <section className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map(({ label, value }) => (
          <Card key={label} className="flex flex-col gap-1.5">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
            <p className="text-2xl font-bold text-slate-900">{value}</p>
          </Card>
        ))}
      </section>

      {/* Recent movements */}
      <Card>
        <h3 className="text-sm font-semibold text-slate-700 mb-4">
          {t('dashboard.recentMovements')}
        </h3>
        <div className="flex flex-col divide-y divide-slate-100">
          {(stockMovements ?? []).length === 0 && (
            <p className="text-sm text-slate-400 py-2">{t('dashboard.noMovements')}</p>
          )}
          {(stockMovements ?? []).map((mv) => (
            <div key={mv.id} className="flex items-center justify-between gap-3 py-3">
              <span className="text-sm font-medium text-slate-700 capitalize">{mv.movementType}</span>
              <span className={`text-sm font-semibold tabular-nums ${mv.quantityChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {mv.quantityChange > 0 ? '+' : ''}{mv.quantityChange}
              </span>
              <span className="text-xs text-slate-400 truncate flex-1 text-end">
                {mv.note || mv.referenceType}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
