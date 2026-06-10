"use client";

import { useMemo, useState } from "react";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getSupplierLedger,
  getSupplierLedgerDetails,
  recordSupplierPayment,
  type SupplierLedgerDetails,
  type SupplierLedgerRow,
} from "@/lib/services/supplier-ledger-service";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DataTable } from "@/components/ui/data-table";
// import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from "@/components/ui/modal";
import { formatCurrency, MONEY_EPSILON } from "@/lib/utils/money";
import { formatDateTime, nowIso } from "@/lib/utils/date";
import { downloadCSV } from "@/lib/utils/export-csv";
import { netSplitField, normalizeBillSplit } from "@/lib/utils/bill-split";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { settingsRepo, supplierRepo } from "@/lib/db/repositories";
import { createId } from "@/lib/utils/id";
import { normalizePhone } from "@/lib/utils/customer-key";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CheckCircle2, Phone } from "lucide-react";
import type { Supplier } from "@/types/domain";

export function SupplierLedgerWorkspace() {
  const { t /* dir */ } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getSupplierLedger(), []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SupplierLedgerDetails | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [newSupplierPhone, setNewSupplierPhone] = useState("");
  const [isSavingSupplier, setIsSavingSupplier] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementFrom, setStatementFrom] = useState("");
  const [statementTo, setStatementTo] = useState("");
  const [amount, setAmount] = useState<number>(0);
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "card" | "bank" | "other"
  >("cash");
  const currency = settings?.currency ?? "ILS";

  const safePaymentAmount = Number.isFinite(amount) ? amount : 0;
  const balanceOwedAtModal = selected?.balanceOwed ?? 0;
  // Mirror of customer overpayment math: only amounts above a positive
  // outstanding balance count as overpayment. Paying a supplier we already
  // owe nothing is automatically a deposit/credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceOwedAtModal)
      ? safePaymentAmount - Math.max(0, balanceOwedAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > MONEY_EPSILON;
  const canSaveSupplier = Boolean(newSupplierName.trim() || newSupplierPhone.trim());

  type SupplierStatementRow = {
    id: string;
    date: string;
    type: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
    note?: string;
  };

  const statementRows = useMemo<SupplierStatementRow[]>(() => {
    if (!selected) return [];
    const allRows = [
      ...selected.purchases.map((purchase) => {
        const withSplit = normalizeBillSplit(purchase);
        const debit = Math.max(0, purchase.totalAmount - (purchase.returnedAmount ?? 0));
        const paidAtPurchase =
          netSplitField(withSplit, withSplit.cashAmount) +
          netSplitField(withSplit, withSplit.cardAmount);
        return {
          id: `purchase-${purchase.id}`,
          date: purchase.invoiceDate ? `${purchase.invoiceDate}T00:00:00.000` : purchase.createdAt,
          type: t("suppliers.statementPurchase"),
          reference: purchase.supplierInvoiceNumber || purchase.purchaseNumber,
          debit,
          credit: Math.max(0, paidAtPurchase),
          note: purchase.notes,
        };
      }),
      ...selected.paymentRows.map((payment) => ({
        id: `payment-${payment.id}`,
        date: payment.createdAt,
        type: t("suppliers.statementPayment"),
        reference: payment.id,
        debit: 0,
        credit: Math.max(0, payment.amount),
        note: payment.note,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    const fromIso = statementFrom ? `${statementFrom}T00:00:00.000` : "";
    const toIso = statementTo ? `${statementTo}T23:59:59.999` : "";
    const opening = allRows
      .filter((row) => fromIso && row.date < fromIso)
      .reduce((sum, row) => sum + row.debit - row.credit, 0);
    let running = opening;
    return allRows
      .filter((row) => (!fromIso || row.date >= fromIso) && (!toIso || row.date <= toIso))
      .map((row) => {
        running += row.debit - row.credit;
        return { ...row, balance: running };
      });
  }, [selected, statementFrom, statementTo, t]);

  const statementSummary = useMemo(() => {
    if (!selected) return { opening: 0, debit: 0, credit: 0, ending: 0 };
    const fromIso = statementFrom ? `${statementFrom}T00:00:00.000` : "";
    const allRows = [
      ...selected.purchases.map((purchase) => {
        const withSplit = normalizeBillSplit(purchase);
        return {
          date: purchase.invoiceDate ? `${purchase.invoiceDate}T00:00:00.000` : purchase.createdAt,
          debit: Math.max(0, purchase.totalAmount - (purchase.returnedAmount ?? 0)),
          credit:
            netSplitField(withSplit, withSplit.cashAmount) +
            netSplitField(withSplit, withSplit.cardAmount),
        };
      }),
      ...selected.paymentRows.map((payment) => ({
        date: payment.createdAt,
        debit: 0,
        credit: payment.amount,
      })),
    ];
    const opening = allRows
      .filter((row) => fromIso && row.date < fromIso)
      .reduce((sum, row) => sum + row.debit - row.credit, 0);
    const debit = statementRows.reduce((sum, row) => sum + row.debit, 0);
    const credit = statementRows.reduce((sum, row) => sum + row.credit, 0);
    return { opening, debit, credit, ending: opening + debit - credit };
  }, [selected, statementFrom, statementRows]);

  async function saveSupplier() {
    const name = newSupplierName.trim();
    const phone = newSupplierPhone.trim();
    if (!name && !phone) {
      push(t("suppliers.supplierRequired"), "error");
      return;
    }

    setIsSavingSupplier(true);
    try {
      const normalizedPhone = normalizePhone(phone);
      const existing = normalizedPhone
        ? await supplierRepo.findByNormalizedPhone(normalizedPhone)
        : undefined;
      const now = nowIso();
      const supplier: Supplier = {
        id: existing?.id ?? createId("supp"),
        name: name || existing?.name || t("suppliers.supplier"),
        phone: phone || undefined,
        normalizedPhone: normalizedPhone || undefined,
        notes: existing?.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncStatus: "pending",
      };

      await supplierRepo.save(supplier);
      setAddOpen(false);
      setNewSupplierName("");
      setNewSupplierPhone("");
      push(existing ? t("suppliers.supplierUpdated") : t("suppliers.supplierSaved"));
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("suppliers.supplierSaveFailed")), "error");
    } finally {
      setIsSavingSupplier(false);
    }
  }

  function exportSupplierStatementCsv() {
    if (!selected) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      statementRows,
      [
        { header: t("suppliers.statementDate"), value: (row) => row.date },
        { header: t("suppliers.statementType"), value: (row) => row.type },
        { header: t("suppliers.statementReference"), value: (row) => row.reference },
        { header: t("suppliers.statementDebit"), value: (row) => row.debit },
        { header: t("suppliers.statementCredit"), value: (row) => row.credit },
        { header: t("suppliers.statementBalance"), value: (row) => row.balance },
        { header: t("suppliers.note"), value: (row) => row.note ?? "" },
      ],
      `asas-supplier-statement-${selected.name.replace(/[^\w\u0600-\u06FF-]+/g, "-")}-${stamp}.csv`,
    );
  }

  async function savePayment() {
    if (!selected) return;
    if (!safePaymentAmount || safePaymentAmount <= 0) {
      push(t("common.invalidAmount"), "error");
      return;
    }
    try {
      await recordSupplierPayment({
        supplierKey: selected.key,
        supplierName: selected.name,
        supplierPhone: selected.phone,
        amount: safePaymentAmount,
        note,
        paymentMethod,
      });
      const details = await getSupplierLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount(0);
      setNote("");
      setPaymentMethod("cash");
      push(t("suppliers.paymentSaved"));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("suppliers.paymentFailed")),
        "error",
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
        {
          totalPurchases: 0,
          payments: 0,
          balanceOwed: 0,
          suppliersWithDebt: 0,
        },
      ),
    [rows],
  );

  async function openDetails(row: SupplierLedgerRow) {
    const details = await getSupplierLedgerDetails(row.key);
    setSelected(details);
  }

  const ledgerColumns: ColumnDef<SupplierLedgerRow>[] = [
    {
      header: t("suppliers.supplier"),
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="font-medium text-slate-900">{row.original.name}</span>
      ),
    },
    {
      header: t("suppliers.phone"),
      accessorKey: "phone",
      cell: ({ row }) => row.original.phone || "—",
    },
    {
      header: t("suppliers.creditPurchases"),
      accessorKey: "creditPurchases",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(row.original.creditPurchases, currency)}
        </span>
      ),
    },
    {
      header: t("suppliers.paid"),
      id: "paid",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(
            row.original.paidOnPurchases + row.original.payments,
            currency,
          )}
        </span>
      ),
    },
    {
      header: t("suppliers.balanceOwed"),
      accessorKey: "balanceOwed",
      cell: ({ row }) => (
        <span
          className={`tabular-nums font-semibold ${row.original.balanceOwed > MONEY_EPSILON ? "text-danger" : row.original.balanceOwed < -MONEY_EPSILON ? "text-info" : "text-success"}`}
        >
          {formatCurrency(row.original.balanceOwed, currency)}
          {row.original.balanceOwed > MONEY_EPSILON && (
            <span className="ms-1 text-[10px] font-medium uppercase tracking-wide text-danger">
              {t("suppliers.creditBalanceNote")}
            </span>
          )}
        </span>
      ),
    },
    { header: t("suppliers.purchaseCount"), accessorKey: "purchaseCount" },
    {
      header: t("suppliers.lastActivity"),
      accessorKey: "lastActivityAt",
      cell: ({ row }) =>
        row.original.lastActivityAt ? (
          <span className="whitespace-nowrap">
            {new Date(row.original.lastActivityAt).toLocaleString()}
          </span>
        ) : (
          "—"
        ),
    },
    {
      header: "",
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => openDetails(row.original)}
        >
          {t("suppliers.view")}
        </Button>
      ),
    },
  ];

  return (
    <PageShell size="wide">
      <PageHeader
        title={t("suppliers.title")}
        description={t("suppliers.subtitle")}
        actions={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button type="button" onClick={() => setAddOpen(true)}>
              {t("suppliers.addSupplier")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSearch("")}>
              {t("suppliers.showAll")}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          filled
          tone="warning"
          label={t("suppliers.totalPurchases")}
          value={formatCurrency(totals.totalPurchases, currency)}
        />
        <StatCard
          filled
          tone="positive"
          label={t("suppliers.totalPaid")}
          value={formatCurrency(totals.payments, currency)}
        />
        <StatCard
          filled
          tone={totals.balanceOwed > MONEY_EPSILON ? "danger" : "positive"}
          label={t("suppliers.totalBalanceOwed")}
          value={formatCurrency(totals.balanceOwed, currency)}
        />
        <StatCard
          filled
          tone="neutral"
          label={t("suppliers.suppliersWithDebt")}
          value={String(totals.suppliersWithDebt)}
        />
      </div>

      <DataTable
        columns={ledgerColumns}
        data={filteredRows}
        title={t("suppliers.ledger")}
        description={t("suppliers.ledgerDesc")}
        loading={!ledger}
        emptyTitle={t("suppliers.noSuppliers")}
        emptyDescription={t("suppliers.noSuppliersDesc")}
        searchPlaceholder={t("suppliers.searchPlaceholder")}
        labels={{
          searchPlaceholder: t("suppliers.searchPlaceholder"),
          loading: t("dataTable.loading"),
          page: t("dataTable.page"),
          of: t("dataTable.of"),
          rowsPerPage: t("dataTable.rowsPerPage"),
          first: t("dataTable.first"),
          previous: t("dataTable.previous"),
          next: t("dataTable.next"),
          last: t("dataTable.last"),
        }}
        pageSize={10}
        getRowId={(row) => row.key}
      />

      <Modal
        open={Boolean(selected)}
        title={selected?.name ?? t("suppliers.supplierDetails")}
        description={selected?.phone ?? t("suppliers.supplierDetailsDesc")}
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelected(null)}
            >
              {t("common.close")}
            </Button>
            {selected && (
              <>
                <Button type="button" variant="secondary" onClick={() => setStatementOpen(true)}>
                  {t("suppliers.statement")}
                </Button>
                <Button type="button" onClick={() => setPaymentOpen(true)}>
                  {t("suppliers.recordPayment")}
                </Button>
              </>
            )}
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard
                label={t("suppliers.creditPurchases")}
                value={formatCurrency(selected.creditPurchases, currency)}
              />
              <StatCard
                label={t("suppliers.paid")}
                value={formatCurrency(
                  selected.paidOnPurchases + selected.payments,
                  currency,
                )}
              />
              <StatCard
                label={t("suppliers.balanceOwed")}
                value={formatCurrency(selected.balanceOwed, currency)}
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                {t("suppliers.purchases")}
              </h3>
              {selected.purchases.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t("suppliers.noPurchases")}
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {selected.purchases.map((purchase) => (
                    <div
                      key={purchase.id}
                      className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {purchase.purchaseNumber}
                        </p>
                        <p className="whitespace-nowrap text-xs text-slate-500">
                          {new Date(purchase.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-end text-sm tabular-nums">
                        <p>{formatCurrency(purchase.totalAmount, currency)}</p>
                        {purchase.creditAmount > MONEY_EPSILON && (
                          <p className="text-danger font-medium">
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
                {t("suppliers.payments")}
              </h3>
              {selected.paymentRows.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {t("suppliers.noPayments")}
                </p>
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
                        <p className="text-xs text-slate-500">
                          {payment.note || "—"}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="whitespace-nowrap text-xs text-slate-500">
                          {new Date(payment.createdAt).toLocaleString()}
                        </p>
                        <RecordSyncBadge status={payment.syncStatus} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={statementOpen && Boolean(selected)}
        title={selected ? t("suppliers.statementFor", { name: selected.name }) : t("suppliers.statement")}
        description={t("suppliers.statementDesc")}
        onClose={() => setStatementOpen(false)}
        presentation="sheet"
        className="sm:max-w-4xl"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setStatementOpen(false)}>
              {t("common.close")}
            </Button>
            <Button type="button" variant="secondary" onClick={exportSupplierStatementCsv}>
              {t("suppliers.exportStatementCsv")}
            </Button>
            <Button type="button" onClick={() => window.print()}>
              {t("suppliers.printStatement")}
            </Button>
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="no-print grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t("reports.fromDate")}
                </span>
                <Input type="date" value={statementFrom} onChange={(event) => setStatementFrom(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  {t("reports.toDate")}
                </span>
                <Input type="date" value={statementTo} onChange={(event) => setStatementTo(event.target.value)} />
              </label>
            </div>

            <div id="receipt-print-area" className="rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 print:border-0">
              <div className="border-b border-dashed border-slate-300 pb-4 text-center">
                <p className="text-lg font-black tracking-tight">{settings?.storeName || "Asas POS"}</p>
                {settings?.businessPhone && <p className="text-xs text-slate-500">{settings.businessPhone}</p>}
                {settings?.businessAddress && <p className="text-xs text-slate-500">{settings.businessAddress}</p>}
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{t("suppliers.statement")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{selected.name}</p>
                {selected.phone && <p className="text-xs text-slate-500">{selected.phone}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {statementFrom || t("reports.allTime")} → {statementTo || t("reports.allTime")}
                </p>
                <p className="text-xs text-slate-500">{t("suppliers.generatedAt")}: {formatDateTime(new Date().toISOString())}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label={t("suppliers.openingBalance")} value={formatCurrency(statementSummary.opening, currency)} />
                <StatCard label={t("suppliers.statementDebit")} value={formatCurrency(statementSummary.debit, currency)} />
                <StatCard label={t("suppliers.statementCredit")} value={formatCurrency(statementSummary.credit, currency)} />
                <StatCard label={t("suppliers.endingBalance")} value={formatCurrency(statementSummary.ending, currency)} />
              </div>

              <div className="mt-4 space-y-2 sm:hidden">
                {statementRows.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{t("suppliers.noStatementRows")}</p>
                ) : statementRows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{row.type}</p>
                        <p className="text-xs text-slate-500">{row.reference} · {formatDateTime(row.date)}</p>
                      </div>
                      <span className="text-xs font-semibold text-slate-500" dir="ltr">{formatCurrency(row.balance, currency)}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <p><span className="text-slate-500">{t("suppliers.statementDebit")}: </span><span dir="ltr">{formatCurrency(row.debit, currency)}</span></p>
                      <p><span className="text-slate-500">{t("suppliers.statementCredit")}: </span><span dir="ltr">{formatCurrency(row.credit, currency)}</span></p>
                    </div>
                    {row.note && <p className="mt-2 text-xs text-slate-500">{row.note}</p>}
                  </div>
                ))}
              </div>

              <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-slate-100 sm:block print:block print:overflow-visible">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start">{t("suppliers.statementDate")}</th>
                      <th className="px-3 py-2 text-start">{t("suppliers.statementType")}</th>
                      <th className="px-3 py-2 text-start">{t("suppliers.statementReference")}</th>
                      <th className="px-3 py-2 text-end">{t("suppliers.statementDebit")}</th>
                      <th className="px-3 py-2 text-end">{t("suppliers.statementCredit")}</th>
                      <th className="px-3 py-2 text-end">{t("suppliers.statementBalance")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-500">{t("suppliers.noStatementRows")}</td></tr>
                    ) : statementRows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.date)}</td>
                        <td className="px-3 py-2">{row.type}</td>
                        <td className="px-3 py-2">{row.reference}</td>
                        <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{formatCurrency(row.debit, currency)}</td>
                        <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{formatCurrency(row.credit, currency)}</td>
                        <td className="px-3 py-2 text-end font-semibold tabular-nums" dir="ltr">{formatCurrency(row.balance, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>


      <Modal
        open={addOpen}
        title={t("suppliers.addSupplier")}
        description={t("suppliers.addSupplierDesc")}
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => setAddOpen(false)}
              disabled={isSavingSupplier}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={saveSupplier}
              disabled={!canSaveSupplier}
              loading={isSavingSupplier}
            >
              {t("suppliers.saveSupplier")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-warning/20 bg-warning-soft/70 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-warning text-white shadow-sm">
                <Building2 size={20} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {t("suppliers.quickAddTitle")}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("suppliers.quickAddHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
                {t("suppliers.supplier")}
              </span>
              <Input
                value={newSupplierName}
                onChange={(event) => setNewSupplierName(event.target.value)}
                placeholder={t("purchases.supplierName")}
                inputSize="lg"
                leftSlot={<Building2 size={18} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="organization"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
                {t("suppliers.phone")}
              </span>
              <Input
                value={newSupplierPhone}
                onChange={(event) => setNewSupplierPhone(event.target.value)}
                placeholder={t("purchases.supplierPhone")}
                type="tel"
                inputMode="tel"
                inputSize="lg"
                leftSlot={<Phone size={18} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="tel"
                dir="ltr"
              />
            </label>
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-success/20 bg-success-soft/70 px-3 py-2 text-xs leading-5 text-success">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>{t("suppliers.addSupplierSyncHint")}</span>
          </p>
        </div>
      </Modal>

      <Modal
        open={paymentOpen}
        title={t("suppliers.recordPayment")}
        description={
          selected
            ? t("suppliers.recordPaymentDesc", { name: selected.name })
            : ""
        }
        onClose={() => setPaymentOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPaymentOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={savePayment}>
              {isOverpayment
                ? t("suppliers.savePaymentCredit")
                : t("suppliers.savePayment")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("suppliers.paymentAmount")}
            </span>
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              currency={currency}
              min={0}
            />
          </label>
          {isOverpayment && (
            <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning">
              {t("suppliers.overpaymentWarning", {
                extra: formatCurrency(overpaymentExtra, currency),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("suppliers.paymentMethod")}
            </span>
            <div className="flex gap-2 flex-wrap">
              {(["cash", "card", "bank", "other"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    paymentMethod === m
                      ? "bg-brand text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {t(`common.${m}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("suppliers.note")}
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("suppliers.notePlaceholder")}
            />
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}
