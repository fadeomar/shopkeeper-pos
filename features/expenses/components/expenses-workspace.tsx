"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { settingsRepo } from "@/lib/db/repositories";
import { listExpenses, recordExpense } from "@/lib/services/expense-service";
import type {
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
} from "@/types/domain";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { formatCurrency, roundMoney } from "@/lib/utils/money";
import { downloadCSV } from "@/lib/utils/export-csv";
import { blurInputOnEnter } from "@/lib/utils/dismiss-on-enter";
import { formatDateTime, localDateKey } from "@/lib/utils/date";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";

const CATEGORIES: ExpenseCategory[] = [
  "rent",
  "utilities",
  "internet",
  "salaries",
  "packaging",
  "delivery",
  "maintenance",
  "marketing",
  "transport",
  "cleaning",
  "office",
  "tax",
  "fees",
  "other",
];

const METHODS: ExpensePaymentMethod[] = ["cash", "card", "bank", "credit"];

function categoryKey(c: ExpenseCategory): string {
  return `expenses.cat${c.charAt(0).toUpperCase()}${c.slice(1)}`;
}

function methodKey(m: ExpensePaymentMethod): string {
  return `expenses.method${m.charAt(0).toUpperCase()}${m.slice(1)}`;
}

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: first.toISOString(), to: last.toISOString() };
}

export function ExpensesWorkspace() {
  const { t } = useLocale();
  const tableLabels = useDataTableLabels();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);

  const expenses = useLiveQuery(() => listExpenses({}), [], [] as Expense[]);
  const currency = settings?.currency ?? "ILS";

  const [open, setOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<"all" | ExpenseCategory>("all");
  const [methodFilter, setMethodFilter] = useState<"all" | ExpensePaymentMethod>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("rent");
  const [paymentMethod, setPaymentMethod] =
    useState<ExpensePaymentMethod>("cash");
  const [amount, setAmount] = useState<number>(0);
  const [payee, setPayee] = useState("");
  const [note, setNote] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => localDateKey());
  const [saving, setSaving] = useState(false);

  const filteredExpenses = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    return expenses.filter((e) => {
      const date = e.expenseDate || e.createdAt.slice(0, 10);
      if (filterFrom && date < filterFrom) return false;
      if (filterTo && date > filterTo) return false;
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (methodFilter !== "all" && e.paymentMethod !== methodFilter) return false;
      if (q) {
        const haystack = [e.payee, e.note, e.category, e.paymentMethod].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [expenses, categoryFilter, methodFilter, filterFrom, filterTo, filterSearch]);

  const { monthTotal, cashTotal, byCategory } = useMemo(() => {
    const { from, to } = currentMonthRange();
    const month = expenses.filter((e) => {
      const date = e.expenseDate ? `${e.expenseDate}T00:00:00.000Z` : e.createdAt;
      return date >= from && date < to;
    });
    const total = month.reduce((sum, e) => sum + e.amount, 0);
    const cash = month
      .filter((e) => e.paymentMethod === "cash")
      .reduce((sum, e) => sum + e.amount, 0);
    const by = new Map<ExpenseCategory, number>();
    for (const e of month)
      by.set(e.category, (by.get(e.category) ?? 0) + e.amount);
    return {
      monthTotal: roundMoney(total),
      cashTotal: roundMoney(cash),
      byCategory: Array.from(by.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [expenses]);

  function resetForm() {
    setCategory("rent");
    setPaymentMethod("cash");
    setAmount(0);
    setPayee("");
    setNote("");
    setExpenseDate(localDateKey());
  }

  async function handleSave() {
    if (!Number.isFinite(amount) || amount <= 0) {
      push(t("common.invalidAmount"), "error");
      return;
    }
    setSaving(true);
    try {
      await recordExpense({
        category,
        amount,
        paymentMethod,
        payee: payee.trim() || undefined,
        note: note.trim() || undefined,
        expenseDate,
        cashierName: settings?.cashierName,
      });
      push(t("expenses.saved"));
      setOpen(false);
      resetForm();
    } catch (error) {
      push(getServiceErrorMessage(error, t, t("expenses.saveFailed")), "error");
    } finally {
      setSaving(false);
    }
  }

  function exportExpensesCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      filteredExpenses,
      [
        { header: t("expenses.expenseDate"), value: (row) => row.expenseDate ?? row.createdAt },
        { header: t("expenses.colCategory"), value: (row) => t(categoryKey(row.category)) },
        { header: t("expenses.colPayee"), value: (row) => row.payee ?? "" },
        { header: t("expenses.note"), value: (row) => row.note ?? "" },
        { header: t("expenses.colAmount"), value: (row) => row.amount },
        { header: t("expenses.colMethod"), value: (row) => t(methodKey(row.paymentMethod)) },
        { header: t("expenses.colShift"), value: (row) => row.shiftId ?? "" },
        { header: t("sync.status"), value: (row) => row.syncStatus ?? "synced" },
      ],
      `asas-expenses-${stamp}.csv`,
    );
  }

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: t("expenses.colTime"),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs tabular-nums text-slate-600">
            {formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        accessorKey: "category",
        header: t("expenses.colCategory"),
        cell: ({ row }) => (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
            {t(categoryKey(row.original.category))}
          </span>
        ),
      },
      {
        accessorKey: "payee",
        header: t("expenses.colPayee"),
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">
            {row.original.payee ?? "—"}
            {row.original.note && (
              <span className="block text-[10px] text-slate-400">
                {row.original.note}
              </span>
            )}
          </span>
        ),
      },
      {
        accessorKey: "amount",
        header: t("expenses.colAmount"),
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-slate-800" dir="ltr">
            {formatCurrency(row.original.amount, currency)}
          </span>
        ),
      },
      {
        accessorKey: "paymentMethod",
        header: t("expenses.colMethod"),
        cell: ({ row }) => (
          <span className="text-xs text-slate-600">
            {t(methodKey(row.original.paymentMethod))}
          </span>
        ),
      },
      {
        accessorKey: "shiftId",
        header: t("expenses.colShift"),
        cell: ({ row }) => (
          <span className="font-mono text-[10px] text-slate-400">
            {row.original.shiftId ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "syncStatus",
        header: t("sync.status"),
        cell: ({ row }) => <RecordSyncBadge status={row.original.syncStatus} />,
      },
    ],
    [t, currency],
  );

  return (
    <PageShell>
      <PageHeader
        title={t("expenses.title")}
        description={t("expenses.subtitle")}
        actions={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={exportExpensesCsv}
              disabled={filteredExpenses.length === 0}
            >
              {t("reports.exportCsv")}
            </Button>
            <Button type="button" onClick={() => setOpen(true)}>
              {t("expenses.addButton")}
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label={t("expenses.monthTotal")}
          value={formatCurrency(monthTotal, currency)}
        />
        <StatCard
          label={t("expenses.cashTotal")}
          value={formatCurrency(cashTotal, currency)}
          tone="warning"
        />
        <Card className="text-sm">
          <p className="text-xs font-medium text-slate-500 mb-2">
            {t("expenses.byCategory")}
          </p>
          {byCategory.length === 0 ? (
            <p className="text-xs text-slate-400">—</p>
          ) : (
            <ul className="space-y-1">
              {byCategory.slice(0, 5).map(([cat, total]) => (
                <li
                  key={cat}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-slate-700">{t(categoryKey(cat))}</span>
                  <span
                    className="font-medium tabular-nums text-slate-800"
                    dir="ltr"
                  >
                    {formatCurrency(total, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("expenses.filterCategory")}
            <SearchableSelect
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter((v ?? "all") as "all" | ExpenseCategory)}
              options={[
                { value: "all", label: t("expenses.allCategories") },
                ...CATEGORIES.map((c) => ({ value: c, label: t(categoryKey(c)) })),
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("expenses.filterMethod")}
            <SearchableSelect
              value={methodFilter}
              onValueChange={(v) => setMethodFilter((v ?? "all") as "all" | ExpensePaymentMethod)}
              options={[
                { value: "all", label: t("expenses.allMethods") },
                ...METHODS.map((m) => ({ value: m, label: t(methodKey(m)) })),
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("expenses.fromDate")}
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("expenses.toDate")}
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} dir="ltr" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            {t("expenses.filterPayee")}
            <Input value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCategoryFilter("all");
              setMethodFilter("all");
              setFilterFrom("");
              setFilterTo("");
              setFilterSearch("");
            }}
          >
            {t("expenses.resetFilters")}
          </Button>
        </div>
      </Card>

      {expenses.length === 0 ? (
        <EmptyState
          title={t("expenses.empty")}
          description={t("expenses.emptyDesc")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filteredExpenses}
          labels={tableLabels}
          enableGlobalSearch={false}
        />
      )}

      <Modal
        open={open}
        onClose={() => (saving ? undefined : setOpen(false))}
        title={t("expenses.addButton")}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={handleSave} disabled={saving}>
              {saving ? t("expenses.saving") : t("expenses.save")}
            </Button>
          </>
        }
      >
        <div className="space-y-3" onKeyDown={blurInputOnEnter}>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.category")}
            </span>
            <SearchableSelect
              value={category}
              onValueChange={(v) =>
                setCategory((v ?? "other") as ExpenseCategory)
              }
              options={CATEGORIES.map((c) => ({
                value: c,
                label: t(categoryKey(c)),
              }))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.amount")}
            </span>
            <MoneyInput
              value={amount}
              onValueChange={setAmount}
              currency={currency}
              min={0}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.paymentMethod")}
            </span>
            <SearchableSelect
              value={paymentMethod}
              onValueChange={(v) =>
                setPaymentMethod((v ?? "cash") as ExpensePaymentMethod)
              }
              options={METHODS.map((m) => ({
                value: m,
                label: t(methodKey(m)),
              }))}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.payee")}
            </span>
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} />
            <span className="text-xs text-slate-500">
              {t("expenses.payeeHelper")}
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.note")}
            </span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t("expenses.expenseDate")}
            </span>
            <Input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              dir="ltr"
            />
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}
