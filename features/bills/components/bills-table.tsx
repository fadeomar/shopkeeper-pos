"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";
import { downloadCSV } from "@/lib/utils/export-csv";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { FitText } from "@/components/ui/fit-text";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/pos/price-display";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-context";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import {
  filterBills,
  getBillNetProfit,
  getBillNetTotal,
  summarizeBills,
  type BillStatusFilter,
  type BillDateFilter,
  type PaymentFilter,
} from "@/features/bills/utils/bill-summary";
import clsx from "clsx";
import type { SyncStatus, Bill } from "@/types/domain";
import type { ColumnDef } from "@tanstack/react-table";

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  const effective = status ?? "synced";
  const styles: Record<SyncStatus, string> = {
    synced: "bg-success-soft text-success border-success/20",
    pending: "bg-warning-soft text-warning border-warning/20",
    syncing: "bg-info-soft text-info border-info/20",
    failed: "bg-danger-soft text-danger border-danger/20",
    conflict: "bg-warning-soft text-warning border-warning/30",
    blocked: "bg-danger-soft text-danger border-danger/30",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border",
        styles[effective],
      )}
    >
      {t(`sync.${effective}`)}
    </span>
  );
}

type SummaryTone = "sales" | "profit" | "count" | "items";

const summaryToneClasses: Record<SummaryTone, { card: string; value: string }> = {
  sales: {
    card: "border-success/20 bg-success-soft/35",
    value: "text-success",
  },
  profit: {
    card: "border-money/20 bg-money-soft/45",
    value: "text-money",
  },
  count: {
    card: "border-info/20 bg-info-soft/35",
    value: "text-info",
  },
  items: {
    card: "border-border-default bg-surface-soft",
    value: "text-slate-900",
  },
};

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: SummaryTone;
}) {
  const styles = summaryToneClasses[tone];
  return (
    <div className={clsx("rounded-2xl border p-4", styles.card)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
        {label}
      </p>
      <FitText
        value={value}
        size="lg"
        className={clsx("mt-2 font-black", styles.value)}
      />
    </div>
  );
}

export function BillsTable() {
  const { t } = useLocale();
  const { canViewProfit } = usePermissions();
  const bills = useLiveQuery(
    () => db.bills.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "ILS";
  const [query, setQuery] = usePersistedState("asas:bills:query", "");
  const [dateFilter, setDateFilter] = usePersistedState<BillDateFilter>("asas:bills:dateFilter", "today");
  const [paymentFilter, setPaymentFilter] = usePersistedState<PaymentFilter>("asas:bills:paymentFilter", "all");
  const [statusFilter, setStatusFilter] = usePersistedState<BillStatusFilter>("asas:bills:statusFilter", "all");
  const [cashierFilter, setCashierFilter] = usePersistedState("asas:bills:cashierFilter", "all");
  const [customFrom, setCustomFrom] = usePersistedState("asas:bills:customFrom", "");
  const [customTo, setCustomTo] = usePersistedState("asas:bills:customTo", "");

  const filteredBills = useMemo(() => {
    return filterBills(bills ?? [], {
      query,
      dateFilter,
      paymentFilter,
      statusFilter,
      cashierFilter,
      customFrom,
      customTo,
    });
  }, [bills, query, dateFilter, paymentFilter, statusFilter, cashierFilter, customFrom, customTo]);

  const summary = useMemo(() => summarizeBills(filteredBills), [filteredBills]);
  const paymentFilterOptions = useMemo(() => {
    const options = [
      { value: "all", label: t("bills.allPayments") },
      { value: "cash", label: t("common.cash") },
      { value: "card", label: t("common.card") },
      { value: "credit", label: t("common.credit") },
    ];
    // Mixed payment is retired. Keep the filter discoverable only when old
    // historical bills in the current result set still need it.
    if (summary.byPayment.mixed > 0) {
      options.splice(3, 0, { value: "mixed", label: t("common.mixed") });
    }
    return options;
  }, [summary.byPayment.mixed, t]);
  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: t("bills.allStatuses") },
      { value: "finalized", label: t("common.finalized") },
      { value: "voided", label: t("common.voided") },
      { value: "partially_returned", label: t("common.partially_returned") },
      { value: "returned", label: t("common.returned") },
    ],
    [t],
  );
  const cashierFilterOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (bills ?? [])
          .map((bill) => bill.cashierName?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return [
      { value: "all", label: t("bills.allCashiers") },
      { value: "__unknown__", label: t("bills.unknownCashier") },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [bills, t]);
  const [mobilePage, setMobilePage] = useState(0);
  const mobilePageSize = 10;
  const mobilePageCount = Math.max(
    1,
    Math.ceil(filteredBills.length / mobilePageSize),
  );
  const mobilePageIndex = Math.min(mobilePage, mobilePageCount - 1);
  const mobileBills = filteredBills.slice(
    mobilePageIndex * mobilePageSize,
    mobilePageIndex * mobilePageSize + mobilePageSize,
  );

  useEffect(() => {
    setMobilePage(0);
  }, [query, dateFilter, paymentFilter, statusFilter, cashierFilter, customFrom, customTo]);

  function exportBillsCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      filteredBills,
      [
        { header: t("bills.billNumber"), value: (row) => row.billNumber },
        { header: t("bills.dateTime"), value: (row) => row.createdAt },
        { header: t("bills.customer"), value: (row) => row.customerName || t("common.walkin") },
        { header: t("bills.cashier"), value: (row) => row.cashierName ?? "" },
        { header: t("bills.itemCount"), value: (row) => row.itemCount },
        { header: t("bills.payment"), value: (row) => t(`common.${row.paymentMethod}`) },
        { header: t("bills.status"), value: (row) => t(`common.${row.status}`) },
        { header: t("bills.total"), value: (row) => getBillNetTotal(row) },
        ...(canViewProfit
          ? [{ header: t("bills.profit"), value: (row: Bill) => getBillNetProfit(row) }]
          : []),
        { header: t("sync.status"), value: (row) => row.syncStatus ?? "synced" },
      ],
      `asas-bills-${stamp}.csv`,
    );
  }

  if (!bills)
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("bills.loadingBills")}</p>
      </Card>
    );
  if (bills.length === 0) {
    return (
      <EmptyState
        title={t("bills.noBills")}
        description={t("bills.noBillsDesc")}
      />
    );
  }

  const columns: ColumnDef<Bill>[] = [
    {
      header: t("bills.billNumber"),
      accessorKey: "billNumber",
      cell: ({ row }) => (
        <span className="font-medium text-slate-800 tabular-nums">
          {row.original.billNumber}
        </span>
      ),
    },
    {
      header: t("bills.dateTime"),
      accessorKey: "createdAt",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      header: t("bills.customer"),
      accessorKey: "customerName",
      cell: ({ row }) => row.original.customerName || t("common.walkin"),
    },
    {
      header: t("bills.cashier"),
      accessorKey: "cashierName",
      cell: ({ row }) => row.original.cashierName || "—",
    },
    { header: t("bills.itemCount"), accessorKey: "itemCount" },
    {
      header: t("bills.total"),
      id: "total",
      cell: ({ row }) => (
        <PriceDisplay
          value={getBillNetTotal(row.original)}
          currency={currency}
          size="sm"
          emphasis
        />
      ),
    },
    ...(canViewProfit
      ? [
          {
            header: t("bills.profit"),
            id: "profit",
            cell: ({ row }: { row: { original: Bill } }) => (
              <PriceDisplay
                value={getBillNetProfit(row.original)}
                currency={currency}
                size="sm"
                className="text-success"
              />
            ),
          } as ColumnDef<Bill>,
        ]
      : []),
    {
      header: t("bills.payment"),
      accessorKey: "paymentMethod",
      cell: ({ row }) => (
        <Badge>
          {t(`common.${row.original.paymentMethod}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      header: t("bills.status"),
      accessorKey: "status",
      cell: ({ row }) => (
        <Badge
          tone={
            row.original.status === "finalized"
              ? "success"
              : row.original.status === "voided"
                ? "danger"
                : "warning"
          }
        >
          {t(`common.${row.original.status}` as Parameters<typeof t>[0])}
        </Badge>
      ),
    },
    {
      header: t("sync.status"),
      accessorKey: "syncStatus",
      cell: ({ row }) => <SyncBadge status={row.original.syncStatus} />,
    },
    {
      header: t("bills.action"),
      id: "action",
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          href={`/bills/${row.original.id}`}
          className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-info transition-colors hover:border-info/30 hover:bg-info-soft"
        >
          {t("bills.viewDetails")}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
          <SummaryCard
            label={t("bills.filteredSales")}
            value={formatCurrency(summary.totalSales, currency)}
            tone="sales"
          />
          {canViewProfit && (
            <SummaryCard
              label={t("bills.filteredProfit")}
              value={formatCurrency(summary.totalProfit, currency)}
              tone="profit"
            />
          )}
          <SummaryCard
            label={t("bills.filteredBills")}
            value={String(summary.billCount)}
            tone="count"
          />
          <SummaryCard
            label={t("bills.filteredItems")}
            value={String(summary.itemCount)}
            tone="items"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-slate-600">
          <div>
            {t("common.cash")}:{" "}
            <strong>{formatCurrency(summary.byPayment.cash, currency)}</strong>
          </div>
          <div>
            {t("common.card")}:{" "}
            <strong>{formatCurrency(summary.byPayment.card, currency)}</strong>
          </div>
          {summary.byPayment.mixed > 0 && (
            <div>
              {t("common.mixed")}:{" "}
              <strong>
                {formatCurrency(summary.byPayment.mixed, currency)}
              </strong>
            </div>
          )}
          <div>
            {t("common.credit")}:{" "}
            <strong>
              {formatCurrency(summary.byPayment.credit, currency)}
            </strong>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-7">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("bills.searchPlaceholder")}
            aria-label={t("bills.searchPlaceholder")}
            className="sm:col-span-2 xl:col-span-2"
          />
          <SearchableSelect
            value={dateFilter}
            onValueChange={(value) =>
              setDateFilter((value ?? "all") as BillDateFilter)
            }
            placeholder={t("bills.dateFilter")}
            searchPlaceholder={t("common.search")}
            options={[
              { value: "all", label: t("bills.allDates") },
              { value: "today", label: t("bills.today") },
              { value: "yesterday", label: t("bills.yesterday") },
              { value: "week", label: t("bills.thisWeek") },
              { value: "month", label: t("bills.thisMonth") },
              { value: "custom", label: t("bills.customRange") },
            ]}
          />
          <SearchableSelect
            value={paymentFilter}
            onValueChange={(value) =>
              setPaymentFilter((value ?? "all") as PaymentFilter)
            }
            placeholder={t("bills.paymentFilter")}
            searchPlaceholder={t("common.search")}
            options={paymentFilterOptions}
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value ?? "all") as BillStatusFilter)
            }
            placeholder={t("bills.statusFilter")}
            searchPlaceholder={t("common.search")}
            options={statusFilterOptions}
          />
          <SearchableSelect
            value={cashierFilter}
            onValueChange={(value) => setCashierFilter(value ?? "all")}
            placeholder={t("bills.cashierFilter")}
            searchPlaceholder={t("common.search")}
            options={cashierFilterOptions}
          />
          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQuery("");
                setDateFilter("today");
                setPaymentFilter("all");
                setStatusFilter("all");
                setCashierFilter("all");
                setCustomFrom("");
                setCustomTo("");
              }}
            >
              {t("common.reset")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={exportBillsCsv}
              disabled={filteredBills.length === 0}
            >
              {t("reports.exportCsv")}
            </Button>
          </div>
        </div>
        {dateFilter === "custom" && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              aria-label={t("bills.fromDate")}
            />
            <Input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              aria-label={t("bills.toDate")}
            />
          </div>
        )}
      </Card>

      <Card padding="sm">
        {filteredBills.length === 0 ? (
          <div className="py-10 text-center text-sm text-slate-500">
            {t("bills.noFilteredBills")}
          </div>
        ) : (
          <>
            <div className="grid gap-3 md:hidden">
              {mobileBills.map((bill) => (
                <Link
                  key={bill.id}
                  href={`/bills/${bill.id}`}
                  className="touch-card block rounded-2xl border border-slate-200 bg-white p-3 shadow-xs active:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 tabular-nums">
                        {bill.billNumber}
                      </p>
                      <p className="text-xs text-slate-500 tabular-nums">
                        {formatDateTime(bill.createdAt)}
                      </p>
                    </div>
                    <SyncBadge status={bill.syncStatus} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">{t("bills.total")}</p>
                      <p className="font-black text-slate-900 tabular-nums">
                        {formatCurrency(getBillNetTotal(bill), currency)}
                      </p>
                    </div>
                    {canViewProfit && (
                      <div className="rounded-xl bg-slate-50 p-2">
                        <p className="text-slate-500">{t("bills.profit")}</p>
                        <p className="font-bold text-success tabular-nums">
                          {formatCurrency(getBillNetProfit(bill), currency)}
                        </p>
                      </div>
                    )}
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">{t("bills.itemCount")}</p>
                      <p className="font-bold text-slate-800 tabular-nums">
                        {bill.itemCount}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="truncate">
                      {bill.customerName || t("common.walkin")}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        {t(
                          `common.${bill.status}` as Parameters<typeof t>[0],
                        )}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                        {t(
                          `common.${bill.paymentMethod}` as Parameters<
                            typeof t
                          >[0],
                        )}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
              {filteredBills.length > mobilePageSize && (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:hidden">
                  <span>
                    {mobilePageIndex + 1} / {mobilePageCount}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setMobilePage((page) => Math.max(page - 1, 0))
                      }
                      disabled={mobilePageIndex === 0}
                    >
                      {t("dataTable.previous")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setMobilePage((page) =>
                          Math.min(page + 1, mobilePageCount - 1),
                        )
                      }
                      disabled={mobilePageIndex >= mobilePageCount - 1}
                    >
                      {t("dataTable.next")}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="hidden md:block">
              <DataTable
                columns={columns}
                data={filteredBills}
                enableGlobalSearch={false}
                pageSize={25}
                emptyTitle={t("bills.noFilteredBills")}
                labels={{
                  searchPlaceholder: t("dataTable.search"),
                  loading: t("dataTable.loading"),
                  page: t("dataTable.page"),
                  of: t("dataTable.of"),
                  rowsPerPage: t("dataTable.rowsPerPage"),
                  first: t("dataTable.first"),
                  previous: t("dataTable.previous"),
                  next: t("dataTable.next"),
                  last: t("dataTable.last"),
                }}
                getRowId={(bill) => String(bill.id)}
                storageKey="asas:bills:table"
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
