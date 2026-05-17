"use client";

import { useMemo, useState } from "react";
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
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { formatCurrency } from "@/lib/utils/money";
import { settingsRepo } from "@/lib/db/repositories";
import type { ColumnDef } from "@tanstack/react-table";


export function CustomerLedgerWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getCustomerLedger(), []);
  const activeShift = useLiveQuery(() => db.shifts.where("status").equals("open").first(), []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerLedgerDetails | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "bank" | "other">("cash");
  const currency = settings?.currency ?? "USD";

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

  const paymentAmountNumeric = Number(amount);
  const safePaymentAmount = Number.isFinite(paymentAmountNumeric)
    ? paymentAmountNumeric
    : 0;
  const balanceDueAtModal = selected?.balanceDue ?? 0;
  // Only treat amounts above an existing positive balance as overpayments;
  // a payment toward an already-credit customer (balanceDue <= 0) is
  // always a deposit on top of credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceDueAtModal)
      ? safePaymentAmount - Math.max(0, balanceDueAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > 0.005;

  async function openDetails(row: CustomerLedgerRow) {
    const details = await getCustomerLedgerDetails(row.key);
    setSelected(details);
  }

  const ledgerColumns: ColumnDef<CustomerLedgerRow>[] = [
    { header: t("customers.customer"), accessorKey: "name", cell: ({ row }) => <span className="font-medium text-slate-900">{row.original.name}</span> },
    { header: t("customers.phone"), accessorKey: "phone", cell: ({ row }) => row.original.phone || "—" },
    { header: t("customers.creditSales"), accessorKey: "creditSales", cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.creditSales, currency)}</span> },
    { header: t("customers.paid"), id: "paid", cell: ({ row }) => <span className="tabular-nums">{formatCurrency(row.original.paidOnBills + row.original.payments, currency)}</span> },
    {
      header: t("customers.balanceDue"),
      accessorKey: "balanceDue",
      cell: ({ row }) => (
        <span className={`tabular-nums font-semibold ${row.original.balanceDue > 0.005 ? "text-red-600" : row.original.balanceDue < -0.005 ? "text-blue-600" : "text-green-600"}`}>
          {formatCurrency(row.original.balanceDue, currency)}
          {row.original.balanceDue < -0.005 && <span className="ms-1 text-[10px] font-medium uppercase tracking-wide text-blue-500">{t("customers.creditBalanceNote")}</span>}
        </span>
      ),
    },
    { header: t("customers.bills"), accessorKey: "billCount" },
    { header: t("customers.lastActivity"), accessorKey: "lastActivityAt", cell: ({ row }) => row.original.lastActivityAt ? new Date(row.original.lastActivityAt).toLocaleString() : "—" },
    { header: "", id: "actions", enableSorting: false, cell: ({ row }) => <Button type="button" size="sm" variant="secondary" onClick={() => openDetails(row.original)}>{t("customers.view")}</Button> },
  ];

  async function savePayment() {
    if (!selected) return;
    try {
      await recordCustomerPayment({
        customerKey: selected.key,
        customerName: selected.name,
        customerPhone: selected.phone,
        amount: Number(amount),
        note,
        paymentMethod,
        shiftId: activeShift?.id,
      });
      const details = await getCustomerLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount("");
      setNote("");
      setPaymentMethod("cash");
      push(t("customers.paymentSaved"));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("customers.paymentFailed"),
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
          <Button type="button" onClick={() => setSearch("")}>
            {t("customers.showAll")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label={t("customers.totalCreditSales")}
          value={formatCurrency(totals.creditSales, currency)}
        />
        <StatCard
          label={t("customers.totalPaid")}
          value={formatCurrency(totals.payments, currency)}
        />
        <StatCard
          label={t("customers.totalBalanceDue")}
          value={formatCurrency(totals.balanceDue, currency)}
        />
        <StatCard
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
              <Button type="button" onClick={() => setPaymentOpen(true)}>
                {t("customers.recordPayment")}
              </Button>
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
                    const netTotal = Math.max(
                      0,
                      bill.totalAmount - (bill.returnedAmount ?? 0),
                    );
                    const due = Math.max(0, netTotal - bill.paidAmount);
                    return (
                      <div
                        key={bill.id}
                        className="rounded-xl border border-slate-100 p-3 flex items-center justify-between gap-3"
                      >
                        <div>
                          <Link
                            href={`/bills/${bill.id}` as any}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {bill.billNumber}
                          </Link>
                          <p className="text-xs text-slate-500">
                            {new Date(bill.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-end text-sm tabular-nums">
                          <p>{formatCurrency(netTotal, currency)}</p>
                          <p className="text-red-600 font-medium">
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
                      <p className="text-xs text-slate-500">
                        {new Date(payment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
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
            <Input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          {isOverpayment && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
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
                      ? "bg-blue-600 text-white"
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
