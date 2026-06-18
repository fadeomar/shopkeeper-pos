"use client";

/**
 * PurchaseHistory — read-only list of past purchase invoices (the buy-side
 * mirror of the bills table). Reads db.purchases via useLiveQuery so it stays
 * current, and reuses the shared DataTable for search + pagination.
 *
 * This backs the /purchases route, which the purchase-entry success card links
 * to as "Purchase history". Before this existed that link 404'd.
 */

import { useMemo, useState } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";
import { downloadCSV } from "@/lib/utils/export-csv";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { useLocale } from "@/components/providers/locale-context";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import type { Purchase } from "@/types/domain";

type PurchaseDateFilter =
  | "all"
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "custom";
type PurchasePaymentStatusFilter = "all" | "paid" | "partial" | "unpaid";

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getDateRange(
  dateFilter: PurchaseDateFilter,
  customFrom: string,
  customTo: string,
): { from?: Date; to?: Date } {
  const today = startOfDay(new Date());
  if (dateFilter === "today") return { from: today, to: addDays(today, 1) };
  if (dateFilter === "yesterday") return { from: addDays(today, -1), to: today };
  if (dateFilter === "week") return { from: addDays(today, -6), to: addDays(today, 1) };
  if (dateFilter === "month") {
    return {
      from: new Date(today.getFullYear(), today.getMonth(), 1),
      to: addDays(today, 1),
    };
  }
  if (dateFilter === "custom") {
    return {
      from: customFrom ? startOfDay(new Date(customFrom)) : undefined,
      to: customTo ? addDays(startOfDay(new Date(customTo)), 1) : undefined,
    };
  }
  return {};
}

function getPurchaseAmountDue(purchase: Purchase): number {
  const netTotal = Math.max(
    0,
    purchase.totalAmount - (purchase.returnedAmount ?? 0),
  );
  return Math.max(0, netTotal - purchase.paidAmount);
}

function matchesPaymentStatus(
  purchase: Purchase,
  filter: PurchasePaymentStatusFilter,
): boolean {
  if (filter === "all") return true;
  const due = getPurchaseAmountDue(purchase);
  if (filter === "paid") return due <= 0;
  if (filter === "partial") return purchase.paidAmount > 0 && due > 0;
  return purchase.paidAmount <= 0 && due > 0;
}

export function PurchaseHistory() {
  const { t } = useLocale();
  const labels = useDataTableLabels();
  const purchases = useLiveQuery(
    () => db.purchases.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "ILS";
  const [query, setQuery] = usePersistedState("asas:purchases:query", "");
  const [dateFilter, setDateFilter] = usePersistedState<PurchaseDateFilter>("asas:purchases:dateFilter", "today");
  const [supplierFilter, setSupplierFilter] = usePersistedState("asas:purchases:supplierFilter", "all");
  const [paymentStatusFilter, setPaymentStatusFilter] =
    usePersistedState<PurchasePaymentStatusFilter>("asas:purchases:paymentStatusFilter", "all");
  const [customFrom, setCustomFrom] = usePersistedState("asas:purchases:customFrom", "");
  const [customTo, setCustomTo] = usePersistedState("asas:purchases:customTo", "");

  const supplierOptions = useMemo(() => {
    const names = Array.from(
      new Set(
        (purchases ?? [])
          .map((purchase) => purchase.supplierName?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return [
      { value: "all", label: t("purchases.allSuppliers") },
      { value: "__unknown__", label: t("purchases.noSupplier") },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [purchases, t]);

  const filteredPurchases = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const { from, to } = getDateRange(dateFilter, customFrom, customTo);
    return (purchases ?? []).filter((purchase) => {
      const created = new Date(purchase.createdAt);
      if (from && created < from) return false;
      if (to && created >= to) return false;

      const supplier = purchase.supplierName?.trim() || "__unknown__";
      if (supplierFilter !== "all" && supplier !== supplierFilter) return false;
      if (!matchesPaymentStatus(purchase, paymentStatusFilter)) return false;

      if (!needle) return true;
      return [
        purchase.purchaseNumber,
        purchase.supplierInvoiceNumber,
        purchase.invoiceDate,
        purchase.supplierName,
        purchase.supplierPhone,
        purchase.cashierName,
        purchase.paymentMethod,
        purchase.status,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [purchases, query, dateFilter, supplierFilter, paymentStatusFilter, customFrom, customTo]);

  function paymentStatusLabel(purchase: Purchase): string {
    const due = getPurchaseAmountDue(purchase);
    if (due <= 0) return t("purchases.paidStatus");
    return purchase.paidAmount > 0
      ? t("purchases.partiallyPaidStatus")
      : t("purchases.unpaidStatus");
  }

  function exportPurchasesCsv() {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCSV(
      filteredPurchases,
      [
        { header: t("purchases.purchaseNumber"), value: (row) => row.purchaseNumber },
        { header: t("purchases.invoiceNumber"), value: (row) => row.supplierInvoiceNumber ?? "" },
        { header: t("purchases.invoiceDateShort"), value: (row) => row.invoiceDate ?? row.createdAt },
        { header: t("purchases.supplier"), value: (row) => row.supplierName ?? "" },
        { header: t("bills.itemCount"), value: (row) => row.itemCount },
        { header: t("purchases.total"), value: (row) => row.totalAmount },
        { header: t("purchases.paid"), value: (row) => row.paidAmount },
        { header: t("purchases.amountDue"), value: (row) => getPurchaseAmountDue(row) },
        { header: t("purchases.paymentStatus"), value: (row) => paymentStatusLabel(row) },
        { header: t("purchases.status"), value: (row) => t(`common.${row.status}`) },
        { header: t("sync.status"), value: (row) => row.syncStatus ?? "synced" },
      ],
      `asas-purchases-${stamp}.csv`,
    );
  }

  const columns = useMemo<ColumnDef<Purchase>[]>(
    () => [
      {
        header: t("purchases.purchaseNumber"),
        accessorKey: "purchaseNumber",
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-info">
            {row.original.purchaseNumber}
          </span>
        ),
      },
      {
        header: t("purchases.invoiceNumber"),
        accessorKey: "supplierInvoiceNumber",
        cell: ({ row }) => (
          <span className="text-slate-600">
            {row.original.supplierInvoiceNumber || "—"}
          </span>
        ),
      },
      {
        header: t("purchases.invoiceDateShort"),
        accessorKey: "invoiceDate",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {row.original.invoiceDate || formatDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        header: t("purchases.supplier"),
        accessorKey: "supplierName",
        cell: ({ row }) => (
          <span className="text-slate-700">
            {row.original.supplierName || "—"}
          </span>
        ),
      },
      {
        header: t("bills.itemCount"),
        accessorKey: "itemCount",
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.itemCount}</span>
        ),
      },
      {
        header: t("purchases.total"),
        id: "total",
        cell: ({ row }) => (
          <span className="font-semibold tabular-nums text-slate-900">
            {formatCurrency(row.original.totalAmount, currency)}
          </span>
        ),
      },
      {
        header: t("purchases.paid"),
        id: "paid",
        cell: ({ row }) => (
          <span className="tabular-nums text-slate-700">
            {formatCurrency(row.original.paidAmount, currency)}
          </span>
        ),
      },
      {
        header: t("purchases.amountDue"),
        id: "due",
        cell: ({ row }) => {
          const due = Math.max(
            0,
            getPurchaseAmountDue(row.original),
          );
          return (
            <span
              className={clsx(
                "font-medium tabular-nums",
                due > 0 ? "text-danger" : "text-slate-500",
              )}
            >
              {formatCurrency(due, currency)}
            </span>
          );
        },
      },
      {
        header: t("purchases.paymentStatus"),
        id: "paymentStatus",
        cell: ({ row }) => {
          const due = getPurchaseAmountDue(row.original);
          const key = due <= 0
            ? "paidStatus"
            : row.original.paidAmount > 0
              ? "partiallyPaidStatus"
              : "unpaidStatus";
          return <Badge>{t(`purchases.${key}` as Parameters<typeof t>[0])}</Badge>;
        },
      },
      {
        header: t("purchases.status"),
        accessorKey: "status",
        cell: ({ row }) => (
          <Badge>
            {t(`common.${row.original.status}` as Parameters<typeof t>[0])}
          </Badge>
        ),
      },

      {
        header: t("bills.action"),
        id: "actions",
        enableSorting: false,
        cell: ({ row }) => (
          <a
            href={`/purchases/${encodeURIComponent(row.original.id)}`}
            className="inline-flex min-h-[34px] items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {t("purchases.viewDetails")}
          </a>
        ),
      },
      {
        header: t("sync.status"),
        id: "sync",
        enableSorting: false,
        cell: ({ row }) => <RecordSyncBadge status={row.original.syncStatus} />,
      },
    ],
    [currency, t],
  );

  if (!purchases) {
    return (
      <Card>
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      </Card>
    );
  }

  if (purchases.length === 0) {
    return <EmptyState title={t("purchases.noPurchases")} />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("purchases.searchPlaceholder")}
            aria-label={t("purchases.searchPlaceholder")}
            className="sm:col-span-2 xl:col-span-2"
          />
          <SearchableSelect
            value={dateFilter}
            onValueChange={(value) =>
              setDateFilter((value ?? "all") as PurchaseDateFilter)
            }
            placeholder={t("purchases.dateFilter")}
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
            value={supplierFilter}
            onValueChange={(value) => setSupplierFilter(value ?? "all")}
            placeholder={t("purchases.supplierFilter")}
            searchPlaceholder={t("common.search")}
            options={supplierOptions}
          />
          <SearchableSelect
            value={paymentStatusFilter}
            onValueChange={(value) =>
              setPaymentStatusFilter(
                (value ?? "all") as PurchasePaymentStatusFilter,
              )
            }
            placeholder={t("purchases.paymentStatusFilter")}
            searchPlaceholder={t("common.search")}
            options={[
              { value: "all", label: t("purchases.allPaymentStatuses") },
              { value: "paid", label: t("purchases.paidStatus") },
              { value: "partial", label: t("purchases.partiallyPaidStatus") },
              { value: "unpaid", label: t("purchases.unpaidStatus") },
            ]}
          />
          <div className="flex flex-col gap-2 sm:flex-row xl:col-start-6 xl:flex-col">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setQuery("");
                setDateFilter("today");
                setSupplierFilter("all");
                setPaymentStatusFilter("all");
                setCustomFrom("");
                setCustomTo("");
              }}
            >
              {t("common.reset")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={exportPurchasesCsv}
              disabled={filteredPurchases.length === 0}
            >
              {t("reports.exportCsv")}
            </Button>
          </div>
        </div>
        {dateFilter === "custom" && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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

      <DataTable
        columns={columns}
        data={filteredPurchases}
        enableGlobalSearch={false}
        emptyTitle={t("purchases.noFilteredPurchases")}
        pageSize={10}
        labels={labels}
        getRowId={(row) => row.id}
        getMobileRowHref={(row) => `/purchases/${encodeURIComponent(row.id)}`}
        getMobileRowAriaLabel={(row) =>
          `${t("purchases.viewDetails")}: ${row.purchaseNumber}`
        }
        storageKey="asas:purchases:table"
      />
    </div>
  );
}
