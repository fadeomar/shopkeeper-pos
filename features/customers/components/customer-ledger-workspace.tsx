'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { getCustomerLedger, getCustomerLedgerDetails, recordCustomerPayment, type CustomerLedgerDetails, type CustomerLedgerRow } from '@/lib/services/customer-ledger-service';
import { useLocale } from '@/components/providers/locale-context';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { formatCurrency } from '@/lib/utils/money';
import { settingsRepo } from '@/lib/db/repositories';

function StatCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </Card>
  );
}

export function CustomerLedgerWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getCustomerLedger(), []);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CustomerLedgerDetails | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const currency = settings?.currency ?? 'USD';

  const rows = ledger ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.phone, row.key].filter(Boolean).some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const totals = useMemo(() => rows.reduce((acc, row) => ({
    creditSales: acc.creditSales + row.creditSales,
    payments: acc.payments + row.paidOnBills + row.payments,
    balanceDue: acc.balanceDue + row.balanceDue,
    customersWithDebt: acc.customersWithDebt + (row.balanceDue > 0.001 ? 1 : 0),
  }), { creditSales: 0, payments: 0, balanceDue: 0, customersWithDebt: 0 }), [rows]);

  async function openDetails(row: CustomerLedgerRow) {
    const details = await getCustomerLedgerDetails(row.key);
    setSelected(details);
  }

  async function savePayment() {
    if (!selected) return;
    try {
      await recordCustomerPayment({
        customerKey: selected.key,
        customerName: selected.name,
        customerPhone: selected.phone,
        amount: Number(amount),
        note,
      });
      const details = await getCustomerLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount('');
      setNote('');
      push(t('customers.paymentSaved'));
    } catch (error) {
      push(error instanceof Error ? error.message : t('customers.paymentFailed'), 'error');
    }
  }

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('customers.title')}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{t('customers.subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setSearch('')}>{t('customers.showAll')}</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard label={t('customers.totalCreditSales')} value={formatCurrency(totals.creditSales, currency)} />
        <StatCard label={t('customers.totalPaid')} value={formatCurrency(totals.payments, currency)} />
        <StatCard label={t('customers.totalBalanceDue')} value={formatCurrency(totals.balanceDue, currency)} />
        <StatCard label={t('customers.customersWithDebt')} value={String(totals.customersWithDebt)} />
      </div>

      <Card className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('customers.ledger')}</h2>
            <p className="text-sm text-slate-500">{t('customers.ledgerDesc')}</p>
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('customers.searchPlaceholder')}
            className="md:max-w-xs"
          />
        </div>

        {!ledger ? (
          <p className="text-sm text-slate-500">{t('common.loading')}</p>
        ) : filteredRows.length === 0 ? (
          <EmptyState title={t('customers.noCustomers')} description={t('customers.noCustomersDesc')} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {[t('customers.customer'), t('customers.phone'), t('customers.creditSales'), t('customers.paid'), t('customers.balanceDue'), t('customers.bills'), t('customers.lastActivity'), ''].map((head) => (
                    <th key={head} className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide">{head}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50/60">
                    <td className="px-3 py-3 font-medium text-slate-900">{row.name}</td>
                    <td className="px-3 py-3 text-slate-500">{row.phone || '—'}</td>
                    <td className="px-3 py-3 tabular-nums">{formatCurrency(row.creditSales, currency)}</td>
                    <td className="px-3 py-3 tabular-nums">{formatCurrency(row.paidOnBills + row.payments, currency)}</td>
                    <td className={`px-3 py-3 tabular-nums font-semibold ${row.balanceDue > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(row.balanceDue, currency)}</td>
                    <td className="px-3 py-3 tabular-nums">{row.billCount}</td>
                    <td className="px-3 py-3 text-slate-500">{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : '—'}</td>
                    <td className="px-3 py-3 text-end">
                      <Button type="button" size="sm" variant="secondary" onClick={() => openDetails(row)}>{t('customers.view')}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        title={selected?.name ?? t('customers.customerDetails')}
        description={selected?.phone ?? t('customers.customerDetailsDesc')}
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setSelected(null)}>{t('common.close')}</Button>
            {selected && <Button type="button" onClick={() => setPaymentOpen(true)}>{t('customers.recordPayment')}</Button>}
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label={t('customers.creditSales')} value={formatCurrency(selected.creditSales, currency)} />
              <StatCard label={t('customers.paid')} value={formatCurrency(selected.paidOnBills + selected.payments, currency)} />
              <StatCard label={t('customers.balanceDue')} value={formatCurrency(selected.balanceDue, currency)} />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">{t('customers.creditBills')}</h3>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {selected.bills.length === 0 ? <p className="text-sm text-slate-500">{t('customers.noCreditBills')}</p> : selected.bills.map((bill) => {
                  const netTotal = Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0));
                  const due = Math.max(0, netTotal - bill.paidAmount);
                  return (
                    <div key={bill.id} className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-slate-900">{bill.billNumber}</p>
                        <p className="text-xs text-slate-500">{new Date(bill.createdAt).toLocaleString()}</p>
                      </div>
                      <div className="text-end text-sm tabular-nums">
                        <p>{formatCurrency(netTotal, currency)}</p>
                        <p className="text-red-600 font-medium">{t('customers.due')}: {formatCurrency(due, currency)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">{t('customers.payments')}</h3>
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {selected.paymentRows.length === 0 ? <p className="text-sm text-slate-500">{t('customers.noPayments')}</p> : selected.paymentRows.map((payment) => (
                  <div key={payment.id} className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">{formatCurrency(payment.amount, currency)}</p>
                      <p className="text-xs text-slate-500">{payment.note || t('customers.payment')}</p>
                    </div>
                    <p className="text-xs text-slate-500">{new Date(payment.createdAt).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={paymentOpen}
        title={t('customers.recordPayment')}
        description={selected ? t('customers.recordPaymentDesc', { name: selected.name }) : ''}
        onClose={() => setPaymentOpen(false)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPaymentOpen(false)}>{t('common.cancel')}</Button>
            <Button type="button" onClick={savePayment}>{t('customers.savePayment')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">{t('customers.paymentAmount')}</span>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">{t('customers.note')}</span>
            <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('customers.notePlaceholder')} />
          </label>
        </div>
      </Modal>
    </div>
  );
}
