'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getSupplierLedger,
  getSupplierLedgerDetails,
  recordSupplierPayment,
  type SupplierLedgerDetails,
  type SupplierLedgerRow,
} from '@/lib/services/supplier-ledger-service';
import { useLocale } from '@/components/providers/locale-context';
import { useToast } from '@/components/ui/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { formatCurrency } from '@/lib/utils/money';
import { settingsRepo } from '@/lib/db/repositories';
import type { ColumnDef } from '@tanstack/react-table';

function StatCard({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
      {helper && <p className="mt-1 text-xs text-slate-500">{helper}</p>}
    </Card>
  );
}

export function SupplierLedgerWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getSupplierLedger(), []);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SupplierLedgerDetails | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'bank' | 'other'>('cash');
  const currency = settings?.currency ?? 'USD';

  const paymentAmountNumeric = Number(amount);
  const safePaymentAmount = Number.isFinite(paymentAmountNumeric) ? paymentAmountNumeric : 0;
  const balanceOwedAtModal = selected?.balanceOwed ?? 0;
  // Mirror of customer overpayment math: only amounts above a positive
  // outstanding balance count as overpayment. Paying a supplier we already
  // owe nothing is automatically a deposit/credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceOwedAtModal)
      ? safePaymentAmount - Math.max(0, balanceOwedAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > 0.005;

  async function savePayment() {
    if (!selected) return;
    try {
      await recordSupplierPayment({
        supplierKey: selected.key,
        supplierName: selected.name,
        supplierPhone: selected.phone,
        amount: Number(amount),
        note,
        paymentMethod,
      });
      const details = await getSupplierLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount('');
      setNote('');
      setPaymentMethod('cash');
      push(t('suppliers.paymentSaved'));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t('suppliers.paymentFailed'),
        'error',
      );
    }
  }

  const rows = ledger ?? [];
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.name, row.phone, row.key]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          totalPurchases: acc.totalPurchases + row.totalPurchases,
          payments: acc.payments + row.paidOnPurchases + row.payments,
          balanceOwed: acc.balanceOwed + row.balanceOwed,
          suppliersWithDebt:
            acc.suppliersWithDebt + (row.balanceOwed > 0.001 ? 1 : 0),
        }),
        { totalPurchases: 0, payments: 0, balanceOwed: 0, suppliersWithDebt: 0 },
      ),
    [rows],
  );

  async function openDetails(row: SupplierLedgerRow) {
    const details = await getSupplierLedgerDetails(row.key);
    setSelected(details);
  }

  const ledgerColumns: ColumnDef<SupplierLedgerRow>[] = [
    { header: t('suppliers.supplier'), accessorKey: 'name', cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span> },
    { header: t('suppliers.phone'), accessorKey: 'phone', cell: ({ row }) => row.original.phone || '—' },
    { header: t('suppliers.creditPurchases'), accessorKey: 'creditPurchases', cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.creditPurchases, currency)}</span> },
    { header: t('suppliers.paid'), id: 'paid', cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.paidOnPurchases + row.original.payments, currency)}</span> },
    {
      header: t('suppliers.balanceOwed'),
      accessorKey: 'balanceOwed',
      cell: ({ row }) => (
        <span className={`tabular-nums font-semibold ${row.original.balanceOwed > 0.005 ? 'text-red-600' : row.original.balanceOwed < -0.005 ? 'text-blue-600' : 'text-green-600'}`}>
          {formatCurrency(row.original.balanceOwed, currency)}
          {row.original.balanceOwed > 0.005 && <span className="ms-1 text-[10px] font-medium uppercase tracking-wide text-red-500">{t('suppliers.creditBalanceNote')}</span>}
        </span>
      ),
    },
    { header: t('suppliers.purchaseCount'), accessorKey: 'purchaseCount' },
    { header: t('suppliers.lastActivity'), accessorKey: 'lastActivityAt', cell: ({ row }) => row.original.lastActivityAt ? new Date(row.original.lastActivityAt).toLocaleString() : '—' },
    { header: '', id: 'actions', enableSorting: false, cell: ({ row }) => <Button type="button" size="sm" variant="secondary" onClick={() => openDetails(row.original)}>{t('suppliers.view')}</Button> },
  ];

  return (
    <div className="space-y-5" dir={dir}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('suppliers.title')}</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">{t('suppliers.subtitle')}</p>
        </div>
        <Button type="button" onClick={() => setSearch('')}>
          {t('suppliers.showAll')}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label={t('suppliers.totalPurchases')}
          value={formatCurrency(totals.totalPurchases, currency)}
        />
        <StatCard
          label={t('suppliers.totalPaid')}
          value={formatCurrency(totals.payments, currency)}
        />
        <StatCard
          label={t('suppliers.totalBalanceOwed')}
          value={formatCurrency(totals.balanceOwed, currency)}
        />
        <StatCard
          label={t('suppliers.suppliersWithDebt')}
          value={String(totals.suppliersWithDebt)}
        />
      </div>

      <DataTable
        columns={ledgerColumns}
        data={filteredRows}
        title={t('suppliers.ledger')}
        description={t('suppliers.ledgerDesc')}
        loading={!ledger}
        emptyTitle={t('suppliers.noSuppliers')}
        emptyDescription={t('suppliers.noSuppliersDesc')}
        searchPlaceholder={t('suppliers.searchPlaceholder')}
        labels={{
          searchPlaceholder: t('suppliers.searchPlaceholder'),
          loading: t('dataTable.loading'),
          page: t('dataTable.page'),
          of: t('dataTable.of'),
          rowsPerPage: t('dataTable.rowsPerPage'),
          first: t('dataTable.first'),
          previous: t('dataTable.previous'),
          next: t('dataTable.next'),
          last: t('dataTable.last'),
        }}
        pageSize={10}
        getRowId={(row) => row.key}
      />

      <Modal
        open={Boolean(selected)}
        title={selected?.name ?? t('suppliers.supplierDetails')}
        description={selected?.phone ?? t('suppliers.supplierDetailsDesc')}
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
              {t('common.close')}
            </Button>
            {selected && (
              <Button type="button" onClick={() => setPaymentOpen(true)}>
                {t('suppliers.recordPayment')}
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard
                label={t('suppliers.creditPurchases')}
                value={formatCurrency(selected.creditPurchases, currency)}
              />
              <StatCard
                label={t('suppliers.paid')}
                value={formatCurrency(
                  selected.paidOnPurchases + selected.payments,
                  currency,
                )}
              />
              <StatCard
                label={t('suppliers.balanceOwed')}
                value={formatCurrency(selected.balanceOwed, currency)}
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                {t('suppliers.purchases')}
              </h3>
              {selected.purchases.length === 0 ? (
                <p className="text-sm text-slate-500">{t('suppliers.noPurchases')}</p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selected.purchases.map((purchase) => (
                    <div
                      key={purchase.id}
                      className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{purchase.purchaseNumber}</p>
                        <p className="text-xs text-slate-500">
                          {new Date(purchase.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-end text-sm tabular-nums">
                        <p>{formatCurrency(purchase.totalAmount, currency)}</p>
                        {purchase.creditAmount > 0.005 && (
                          <p className="text-red-600 font-medium">
                            {formatCurrency(purchase.creditAmount, currency)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                {t('suppliers.payments')}
              </h3>
              {selected.paymentRows.length === 0 ? (
                <p className="text-sm text-slate-500">{t('suppliers.noPayments')}</p>
              ) : (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  {selected.paymentRows.map((payment) => (
                    <div
                      key={payment.id}
                      className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {formatCurrency(payment.amount, currency)}
                        </p>
                        <p className="text-xs text-slate-500">{payment.note || '—'}</p>
                      </div>
                      <p className="text-xs text-slate-500">
                        {new Date(payment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={paymentOpen}
        title={t('suppliers.recordPayment')}
        description={selected ? t('suppliers.recordPaymentDesc', { name: selected.name }) : ''}
        onClose={() => setPaymentOpen(false)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setPaymentOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={savePayment}>
              {isOverpayment ? t('suppliers.savePaymentCredit') : t('suppliers.savePayment')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t('suppliers.paymentAmount')}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              step="0.01"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {isOverpayment && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {t('suppliers.overpaymentWarning', {
                extra: formatCurrency(overpaymentExtra, currency),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t('suppliers.paymentMethod')}
            </span>
            <div className="flex gap-2 flex-wrap">
              {(['cash', 'card', 'bank', 'other'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    paymentMethod === m
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {t(`common.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t('suppliers.note')}
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('suppliers.notePlaceholder')}
            />
          </label>
        </div>
      </Modal>
    </div>
  );
}
