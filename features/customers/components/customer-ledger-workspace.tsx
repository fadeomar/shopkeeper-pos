"use client";

import { useMemo, useState } from "react";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import {
  getCustomerLedger,
  getCustomerLedgerDetails,
  recordCustomerPayment,
  type CustomerLedgerDetails,
  type CustomerLedgerRow,
} from "@/lib/services/customer-ledger-service";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { DataTable } from "@/components/ui/data-table";
// import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { formatCurrency, MONEY_EPSILON } from "@/lib/utils/money";
import { formatDateTime, nowIso } from "@/lib/utils/date";
import { downloadCSV } from "@/lib/utils/export-csv";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { netSplitField, normalizeBillSplit } from "@/lib/utils/bill-split";
import { customerRepo, settingsRepo } from "@/lib/db/repositories";
import { createId } from "@/lib/utils/id";
import { normalizePhone } from "@/lib/utils/customer-key";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Phone, UserRound } from "lucide-react";
import type { Customer } from "@/types/domain";

export function CustomerLedgerWorkspace() {
  const { t /* dir */ } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getCustomerLedger(), []);
  const activeShift = useLiveQuery(
    () => db.shifts.where("status").equals("open").first(),
    [],
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerLedgerDetails | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [isSavingCustomer, setIsSavingCustomer] = useState(false);
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
          creditSales: acc.creditSales + row.creditSales,
          payments: acc.payments + row.paidOnBills + row.payments,
          balanceDue: acc.balanceDue + row.balanceDue,
          customersWithDebt:
            acc.customersWithDebt + (row.balanceDue > 0.001 ? 1 : 0),
        }),
        { creditSales: 0, payments: 0, balanceDue: 0, customersWithDebt: 0 },
      ),
    [rows],
  );

  const safePaymentAmount = Number.isFinite(amount) ? amount : 0;
  const balanceDueAtModal = selected?.balanceDue ?? 0;
  // Only treat amounts above an existing positive balance as overpayments;
  // a payment toward an already-credit customer (balanceDue <= 0) is
  // always a deposit on top of credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceDueAtModal)
      ? safePaymentAmount - Math.max(0, balanceDueAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > MONEY_EPSILON;
  const canSaveCustomer = Boolean(newCustomerName.trim() || newCustomerPhone.trim());

  type CustomerStatementRow = {
    id: string;
    date: string;
    type: string;
    reference: string;
    debit: number;
    credit: number;
    balance: number;
    note?: string;
  };

  const statementRows = useMemo<CustomerStatementRow[]>(() => {
    if (!selected) return [];
    const allRows = [
      ...selected.bills.map((bill) => {
        const withSplit = normalizeBillSplit(bill);
        const debit = Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0));
        const paidAtSale =
          netSplitField(withSplit, withSplit.cashAmount) +
          netSplitField(withSplit, withSplit.cardAmount);
        return {
          id: `bill-${bill.id}`,
          date: bill.createdAt,
          type: t("customers.statementBill"),
          reference: bill.billNumber,
          debit,
          credit: Math.max(0, paidAtSale),
          note: bill.notes,
        };
      }),
      ...selected.paymentRows.map((payment) => ({
        id: `payment-${payment.id}`,
        date: payment.createdAt,
        type: t("customers.statementPayment"),
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
    if (!selected) {
      return { opening: 0, debit: 0, credit: 0, ending: 0 };
    }
    const fromIso = statementFrom ? `${statementFrom}T00:00:00.000` : "";
    const allRows = [
      ...selected.bills.map((bill) => {
        const withSplit = normalizeBillSplit(bill);
        return {
          date: bill.createdAt,
          debit: Math.max(0, bill.totalAmount - (bill.returnedAmount ?? 0)),
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

  async function saveCustomer() {
    const name = newCustomerName.trim();
    const phone = newCustomerPhone.trim();
    if (!name && !phone) {
      push(t("customers.customerRequired"), "error");
      return;
    }

    setIsSavingCustomer(true);
    try {
      const normalizedPhone = normalizePhone(phone);
      const existing = normalizedPhone
        ? await customerRepo.findByNormalizedPhone(normalizedPhone)
        : undefined;
      const now = nowIso();
      const customer: Customer = {
        id: existing?.id ?? createId("cust"),
        name: name || existing?.name || t("customers.customer"),
        phone: phone || undefined,
        normalizedPhone: normalizedPhone || undefined,
        notes: existing?.notes,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        syncStatus: "pending",
      };

      await customerRepo.save(customer);
      setAddOpen(false);
      setNewCustomerName("");
      setNewCustomerPhone("");
      push(existing ? t("customers.customerUpdated") : t("customers.customerSaved"));
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("customers.customerSaveFailed")), "error");
    } finally {
      setIsSavingCustomer(false);
    }
  }

  function exportCustomerStatementCsv() {
    if (!selected) return;
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      statementRows,
      [
        { header: t("customers.statementDate"), value: (row) => row.date },
        { header: t("customers.statementType"), value: (row) => row.type },
        { header: t("customers.statementReference"), value: (row) => row.reference },
        { header: t("customers.statementDebit"), value: (row) => row.debit },
        { header: t("customers.statementCredit"), value: (row) => row.credit },
        { header: t("customers.statementBalance"), value: (row) => row.balance },
        { header: t("customers.note"), value: (row) => row.note ?? "" },
      ],
      `asas-customer-statement-${selected.name.replace(/[^\w\u0600-\u06FF-]+/g, "-")}-${stamp}.csv`,
    );
  }

  async function openDetails(row: CustomerLedgerRow) {
    const details = await getCustomerLedgerDetails(row.key);
    setSelected(details);
  }

  const ledgerColumns: ColumnDef<CustomerLedgerRow>[] = [
    {
      header: t("customers.customer"),
      accessorKey: "name",
      cell: ({ row }) => (
        <span className="font-medium text-slate-900">{row.original.name}</span>
      ),
    },
    {
      header: t("customers.phone"),
      accessorKey: "phone",
      cell: ({ row }) => row.original.phone || "—",
    },
    {
      header: t("customers.creditSales"),
      accessorKey: "creditSales",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(row.original.creditSales, currency)}
        </span>
      ),
    },
    {
      header: t("customers.paid"),
      id: "paid",
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(
            row.original.paidOnBills + row.original.payments,
            currency,
          )}
        </span>
      ),
    },
    {
      header: t("customers.balanceDue"),
      accessorKey: "balanceDue",
      cell: ({ row }) => (
        <span
          className={`tabular-nums font-semibold ${row.original.balanceDue > MONEY_EPSILON ? "text-danger" : row.original.balanceDue < -MONEY_EPSILON ? "text-info" : "text-success"}`}
        >
          {formatCurrency(row.original.balanceDue, currency)}
          {row.original.balanceDue < -MONEY_EPSILON && (
            <span className="ms-1 text-[10px] font-medium uppercase tracking-wide text-info">
              {t("customers.creditBalanceNote")}
            </span>
          )}
        </span>
      ),
    },
    { header: t("customers.bills"), accessorKey: "billCount" },
    {
      header: t("customers.lastActivity"),
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
          {t("customers.view")}
        </Button>
      ),
    },
  ];

  async function savePayment() {
    if (!selected) return;
    if (!safePaymentAmount || safePaymentAmount <= 0) {
      push(t("common.invalidAmount"), "error");
      return;
    }
    try {
      await recordCustomerPayment({
        customerKey: selected.key,
        customerName: selected.name,
        customerPhone: selected.phone,
        amount: safePaymentAmount,
        note,
        paymentMethod,
        shiftId: activeShift?.id,
      });
      const details = await getCustomerLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount(0);
      setNote("");
      setPaymentMethod("cash");
      push(t("customers.paymentSaved"));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("customers.paymentFailed")),
        "error",
      );
    }
  }

  return (
    <PageShell size="wide">
      <PageHeader
        title={t("customers.title")}
        description={t("customers.subtitle")}
        actions={
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Button type="button" onClick={() => setAddOpen(true)}>
              {t("customers.addCustomer")}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSearch("")}>
              {t("customers.showAll")}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          filled
          tone="brand"
          label={t("customers.totalCreditSales")}
          value={formatCurrency(totals.creditSales, currency)}
        />
        <StatCard
          filled
          tone="positive"
          label={t("customers.totalPaid")}
          value={formatCurrency(totals.payments, currency)}
        />
        <StatCard
          filled
          tone={totals.balanceDue > MONEY_EPSILON ? "danger" : "positive"}
          label={t("customers.totalBalanceDue")}
          value={formatCurrency(totals.balanceDue, currency)}
        />
        <StatCard
          filled
          tone="neutral"
          label={t("customers.customersWithDebt")}
          value={String(totals.customersWithDebt)}
        />
      </div>

      <DataTable
        columns={ledgerColumns}
        data={filteredRows}
        title={t("customers.ledger")}
        description={t("customers.ledgerDesc")}
        loading={!ledger}
        emptyTitle={t("customers.noCustomers")}
        emptyDescription={t("customers.noCustomersDesc")}
        searchPlaceholder={t("customers.searchPlaceholder")}
        labels={{
          searchPlaceholder: t("customers.searchPlaceholder"),
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
        title={selected?.name ?? t("customers.customerDetails")}
        description={selected?.phone ?? t("customers.customerDetailsDesc")}
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
                  {t("customers.statement")}
                </Button>
                <Button type="button" onClick={() => setPaymentOpen(true)}>
                  {t("customers.recordPayment")}
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
                label={t("customers.creditSales")}
                value={formatCurrency(selected.creditSales, currency)}
              />
              <StatCard
                label={t("customers.paid")}
                value={formatCurrency(
                  selected.paidOnBills + selected.payments,
                  currency,
                )}
              />
              <StatCard
                label={t("customers.balanceDue")}
                value={formatCurrency(selected.balanceDue, currency)}
              />
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                {t("customers.creditBills")}
              </h3>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {selected.bills.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {t("customers.noCreditBills")}
                  </p>
                ) : (
                  selected.bills.map((bill) => {
                    // Use the split-aware helper so partial returns and deposits
                    // are handled consistently with the customer balance summary.
                    const withSplit = normalizeBillSplit(bill);
                    const netTotal = Math.max(
                      0,
                      bill.totalAmount - (bill.returnedAmount ?? 0),
                    );
                    const due = netSplitField(
                      withSplit,
                      withSplit.creditAmount,
                    );
                    return (
                      <div
                        key={bill.id}
                        className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                      >
                        <div>
                          <Link
                            href={`/bills/${bill.id}` as any}
                            className="font-medium text-info hover:underline"
                          >
                            {bill.billNumber}
                          </Link>
                          <p className="whitespace-nowrap text-xs text-slate-500">
                            {new Date(bill.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-end text-sm tabular-nums">
                          <p>{formatCurrency(netTotal, currency)}</p>
                          <p className="text-danger font-medium">
                            {t("customers.due")}:{" "}
                            {formatCurrency(due, currency)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                {t("customers.payments")}
              </h3>
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {selected.paymentRows.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {t("customers.noPayments")}
                  </p>
                ) : (
                  selected.paymentRows.map((payment) => (
                    <div
                      key={payment.id}
                      className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {formatCurrency(payment.amount, currency)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {payment.note || t("customers.payment")}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <p className="whitespace-nowrap text-xs text-slate-500">
                          {new Date(payment.createdAt).toLocaleString()}
                        </p>
                        <RecordSyncBadge status={payment.syncStatus} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={statementOpen && Boolean(selected)}
        title={selected ? t("customers.statementFor", { name: selected.name }) : t("customers.statement")}
        description={t("customers.statementDesc")}
        onClose={() => setStatementOpen(false)}
        presentation="sheet"
        className="sm:max-w-4xl"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setStatementOpen(false)}>
              {t("common.close")}
            </Button>
            <Button type="button" variant="secondary" onClick={exportCustomerStatementCsv}>
              {t("customers.exportStatementCsv")}
            </Button>
            <Button type="button" onClick={() => window.print()}>
              {t("customers.printStatement")}
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
                <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{t("customers.statement")}</p>
                <p className="mt-1 text-sm font-semibold text-slate-800">{selected.name}</p>
                {selected.phone && <p className="text-xs text-slate-500">{selected.phone}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {statementFrom || t("reports.allTime")} → {statementTo || t("reports.allTime")}
                </p>
                <p className="text-xs text-slate-500">{t("customers.generatedAt")}: {formatDateTime(new Date().toISOString())}</p>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <StatCard label={t("customers.openingBalance")} value={formatCurrency(statementSummary.opening, currency)} />
                <StatCard label={t("customers.statementDebit")} value={formatCurrency(statementSummary.debit, currency)} />
                <StatCard label={t("customers.statementCredit")} value={formatCurrency(statementSummary.credit, currency)} />
                <StatCard label={t("customers.endingBalance")} value={formatCurrency(statementSummary.ending, currency)} />
              </div>

              <div className="mt-4 space-y-2 sm:hidden">
                {statementRows.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">{t("customers.noStatementRows")}</p>
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
                      <p><span className="text-slate-500">{t("customers.statementDebit")}: </span><span dir="ltr">{formatCurrency(row.debit, currency)}</span></p>
                      <p><span className="text-slate-500">{t("customers.statementCredit")}: </span><span dir="ltr">{formatCurrency(row.credit, currency)}</span></p>
                    </div>
                    {row.note && <p className="mt-2 text-xs text-slate-500">{row.note}</p>}
                  </div>
                ))}
              </div>

              <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-slate-100 sm:block print:block print:overflow-visible">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-start">{t("customers.statementDate")}</th>
                      <th className="px-3 py-2 text-start">{t("customers.statementType")}</th>
                      <th className="px-3 py-2 text-start">{t("customers.statementReference")}</th>
                      <th className="px-3 py-2 text-end">{t("customers.statementDebit")}</th>
                      <th className="px-3 py-2 text-end">{t("customers.statementCredit")}</th>
                      <th className="px-3 py-2 text-end">{t("customers.statementBalance")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {statementRows.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-500">{t("customers.noStatementRows")}</td></tr>
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
        title={t("customers.addCustomer")}
        description={t("customers.addCustomerDesc")}
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => setAddOpen(false)}
              disabled={isSavingCustomer}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              className="w-full sm:w-auto"
              onClick={saveCustomer}
              disabled={!canSaveCustomer}
              loading={isSavingCustomer}
            >
              {t("customers.saveCustomer")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-brand/15 bg-brand-soft/60 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-sm">
                <UserRound size={20} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">
                  {t("customers.quickAddTitle")}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {t("customers.quickAddHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
                {t("customers.customer")}
              </span>
              <Input
                value={newCustomerName}
                onChange={(event) => setNewCustomerName(event.target.value)}
                placeholder={t("billing.customerName")}
                inputSize="lg"
                leftSlot={<UserRound size={18} aria-hidden />}
                className="[font-size:16px]"
                autoComplete="name"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
                {t("customers.phone")}
              </span>
              <Input
                value={newCustomerPhone}
                onChange={(event) => setNewCustomerPhone(event.target.value)}
                placeholder={t("billing.customerPhone")}
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
            <span>{t("customers.addCustomerSyncHint")}</span>
          </p>
        </div>
      </Modal>

      <Modal
        open={paymentOpen}
        title={t("customers.recordPayment")}
        description={
          selected
            ? t("customers.recordPaymentDesc", { name: selected.name })
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
                ? t("customers.savePaymentCredit")
                : t("customers.savePayment")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("customers.paymentAmount")}
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
              {t("customers.overpaymentWarning", {
                extra: formatCurrency(overpaymentExtra, currency),
              })}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("customers.paymentMethod")}
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
              {t("customers.note")}
            </span>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("customers.notePlaceholder")}
            />
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}
