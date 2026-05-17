"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/pos/price-display";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/providers/locale-context";
import {
  filterBills,
  getBillNetProfit,
  getBillNetTotal,
  summarizeBills,
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
    synced: "bg-green-50 text-green-700 border-green-100",
    pending: "bg-amber-50 text-amber-700 border-amber-100",
    syncing: "bg-blue-50 text-blue-700 border-blue-100",
    failed: "bg-red-50 text-red-700 border-red-100",
    conflict: "bg-amber-100 text-amber-800 border-amber-200",
    blocked: "bg-red-100 text-red-800 border-red-200",
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-black text-slate-900 tabular-nums">
        {value}
      </p>
    </div>
  );
}

export function BillsTable() {
  const { t } = useLocale();
  const bills = useLiveQuery(
    () => db.bills.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "USD";
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState<BillDateFilter>("today");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const filteredBills = useMemo(() => {
    return filterBills(bills ?? [], {
      query,
      dateFilter,
      paymentFilter,
      customFrom,
      customTo,
    });
  }, [bills, query, dateFilter, paymentFilter, customFrom, customTo]);

  const summary = useMemo(() => summarizeBills(filteredBills), [filteredBills]);
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
  }, [query, dateFilter, paymentFilter, customFrom, customTo]);

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
      cell: ({ row }) => formatDateTime(row.original.createdAt),
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
    {
      header: t("bills.profit"),
      id: "profit",
      cell: ({ row }) => (
        <PriceDisplay
          value={getBillNetProfit(row.original)}
          currency={currency}
          size="sm"
          className="text-green-700"
        />
      ),
    },
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
          className="inline-flex items-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-50"
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
          />
          <SummaryCard
            label={t("bills.filteredProfit")}
            value={formatCurrency(summary.totalProfit, currency)}
          />
          <SummaryCard
            label={t("bills.filteredBills")}
            value={String(summary.billCount)}
          />
          <SummaryCard
            label={t("bills.filteredItems")}
            value={String(summary.itemCount)}
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
          <div>
            {t("common.mixed")}:{" "}
            <strong>{formatCurrency(summary.byPayment.mixed, currency)}</strong>
          </div>
          <div>
            {t("common.credit")}:{" "}
            <strong>
              {formatCurrency(summary.byPayment.credit, currency)}
            </strong>
          </div>
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("bills.searchPlaceholder")}
            aria-label={t("bills.searchPlaceholder")}
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
            options={[
              { value: "all", label: t("bills.allPayments") },
              { value: "cash", label: t("common.cash") },
              { value: "card", label: t("common.card") },
              { value: "mixed", label: t("common.mixed") },
              { value: "credit", label: t("common.credit") },
            ]}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setQuery("");
              setDateFilter("today");
              setPaymentFilter("all");
              setCustomFrom("");
              setCustomTo("");
            }}
          >
            {t("common.reset")}
          </Button>
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
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">{t("bills.profit")}</p>
                      <p className="font-bold text-green-700 tabular-nums">
                        {formatCurrency(getBillNetProfit(bill), currency)}
                      </p>
                    </div>
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
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                      {t(
                        `common.${bill.paymentMethod}` as Parameters<
                          typeof t
                        >[0],
                      )}
                    </span>
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
                      Previous
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
                      Next
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
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
