"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { LoadingState } from "@/components/ui/loading-state";
import { SectionCard } from "@/components/ui/section-card";
import { TableShell } from "@/components/ui/table-shell";
import { Toolbar } from "@/components/ui/toolbar";
import { FormField } from "@/components/ui/form-field";
import { PriceDisplay } from "@/components/pos/price-display";
import { useLocale } from "@/components/providers/locale-context";
import { typographyClasses } from "@/lib/design/variants";
import {
  filterBills,
  getBillNetProfit,
  getBillNetTotal,
  summarizeBills,
  type BillDateFilter,
  type PaymentFilter,
} from "@/features/bills/utils/bill-summary";
import type { SyncStatus } from "@/types/domain";

function syncTone(status?: SyncStatus) {
  switch (status ?? "synced") {
    case "synced":
      return "success" as const;
    case "syncing":
      return "info" as const;
    case "pending":
    case "conflict":
      return "warning" as const;
    case "failed":
    case "blocked":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
}

function billTone(status: string) {
  if (status === "finalized") return "success" as const;
  if (status === "voided") return "danger" as const;
  return "warning" as const;
}

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  const effective = status ?? "synced";
  return (
    <StatusPill
      status={effective}
      tone={syncTone(effective)}
      label={t(`sync.${effective}` as Parameters<typeof t>[0])}
    />
  );
}

function SummaryCard({
  label,
  value,
  money = false,
  currency,
}: {
  label: string;
  value: number;
  money?: boolean;
  currency: string;
}) {
  return (
    <SectionCard padding="sm" className="gap-2">
      <p className={typographyClasses.statLabel}>{label}</p>
      {money ? (
        <PriceDisplay value={value} currency={currency} size="xl" emphasis />
      ) : (
        <p className="text-2xl font-bold text-slate-900 tabular-nums">
          {value}
        </p>
      )}
    </SectionCard>
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

  if (!bills) {
    return <LoadingState title={t("bills.loadingBills")} />;
  }

  if (bills.length === 0) {
    return (
      <EmptyState
        title={t("bills.noBills")}
        description={t("bills.noBillsDesc")}
      />
    );
  }

  const headers = [
    t("bills.billNumber"),
    t("bills.dateTime"),
    t("bills.customer"),
    t("bills.cashier"),
    t("bills.itemCount"),
    t("bills.total"),
    t("bills.profit"),
    t("bills.payment"),
    t("bills.status"),
    t("sync.status"),
    t("bills.action"),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label={t("bills.filteredSales")}
          value={summary.totalSales}
          money
          currency={currency}
        />
        <SummaryCard
          label={t("bills.filteredProfit")}
          value={summary.totalProfit}
          money
          currency={currency}
        />
        <SummaryCard
          label={t("bills.filteredBills")}
          value={summary.billCount}
          currency={currency}
        />
        <SummaryCard
          label={t("bills.filteredItems")}
          value={summary.itemCount}
          currency={currency}
        />
      </div>

      <SectionCard>
        <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 md:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className={typographyClasses.statLabel}>{t("common.cash")}</p>
            <PriceDisplay
              value={summary.byPayment.cash}
              currency={currency}
              emphasis
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className={typographyClasses.statLabel}>{t("common.card")}</p>
            <PriceDisplay
              value={summary.byPayment.card}
              currency={currency}
              emphasis
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className={typographyClasses.statLabel}>{t("common.mixed")}</p>
            <PriceDisplay
              value={summary.byPayment.mixed}
              currency={currency}
              emphasis
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <p className={typographyClasses.statLabel}>{t("common.credit")}</p>
            <PriceDisplay
              value={summary.byPayment.credit}
              currency={currency}
              emphasis
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <Toolbar
          align="start"
          className="grid w-full grid-cols-1 items-end md:grid-cols-4"
        >
          <FormField label={t("bills.searchPlaceholder")}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("bills.searchPlaceholder")}
              aria-label={t("bills.searchPlaceholder")}
            />
          </FormField>
          <FormField label={t("bills.dateFilter")}>
            <Select
              value={dateFilter}
              onChange={(event) =>
                setDateFilter(event.target.value as BillDateFilter)
              }
              aria-label={t("bills.dateFilter")}
            >
              <option value="all">{t("bills.allDates")}</option>
              <option value="today">{t("bills.today")}</option>
              <option value="yesterday">{t("bills.yesterday")}</option>
              <option value="week">{t("bills.thisWeek")}</option>
              <option value="month">{t("bills.thisMonth")}</option>
              <option value="custom">{t("bills.customRange")}</option>
            </Select>
          </FormField>
          <FormField label={t("bills.paymentFilter")}>
            <Select
              value={paymentFilter}
              onChange={(event) =>
                setPaymentFilter(event.target.value as PaymentFilter)
              }
              aria-label={t("bills.paymentFilter")}
            >
              <option value="all">{t("bills.allPayments")}</option>
              <option value="cash">{t("common.cash")}</option>
              <option value="card">{t("common.card")}</option>
              <option value="mixed">{t("common.mixed")}</option>
              <option value="credit">{t("common.credit")}</option>
            </Select>
          </FormField>
          <Button
            type="button"
            variant="outline"
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
        </Toolbar>
        {dateFilter === "custom" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label={t("bills.fromDate")}>
              <Input
                type="date"
                value={customFrom}
                onChange={(event) => setCustomFrom(event.target.value)}
                aria-label={t("bills.fromDate")}
              />
            </FormField>
            <FormField label={t("bills.toDate")}>
              <Input
                type="date"
                value={customTo}
                onChange={(event) => setCustomTo(event.target.value)}
                aria-label={t("bills.toDate")}
              />
            </FormField>
          </div>
        )}
      </SectionCard>

      <TableShell
        title={t("bills.title")}
        description={`${filteredBills.length} / ${bills.length}`}
        empty={
          filteredBills.length === 0 ? (
            <EmptyState title={t("bills.noFilteredBills")} compact />
          ) : undefined
        }
      >
        {filteredBills.length > 0 && (
          <>
            <div className="grid gap-3 md:hidden">
              {filteredBills.map((bill) => (
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
                      <PriceDisplay
                        value={getBillNetTotal(bill)}
                        currency={currency}
                        emphasis
                      />
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2">
                      <p className="text-slate-500">{t("bills.profit")}</p>
                      <PriceDisplay
                        value={getBillNetProfit(bill)}
                        currency={currency}
                        className="text-green-700"
                      />
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
                    <Badge tone="neutral">
                      {t(
                        `common.${bill.paymentMethod}` as Parameters<
                          typeof t
                        >[0],
                      )}
                    </Badge>
                  </div>
                </Link>
              ))}
            </div>

            <div className="hidden md:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    {headers.map((h) => (
                      <th key={h} className={typographyClasses.tableHeader}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBills.map((bill) => (
                    <tr
                      key={bill.id}
                      className="transition-colors hover:bg-slate-50/60"
                    >
                      <td className={typographyClasses.tableCellStrong}>
                        {bill.billNumber}
                      </td>
                      <td className="px-3 py-3 text-slate-600 tabular-nums whitespace-nowrap">
                        {formatDateTime(bill.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {bill.customerName || t("common.walkin")}
                      </td>
                      <td className="px-3 py-3 text-slate-700">
                        {bill.cashierName || "—"}
                      </td>
                      <td className="px-3 py-3 text-slate-700 tabular-nums">
                        {bill.itemCount}
                      </td>
                      <td className="px-3 py-3">
                        <PriceDisplay
                          value={getBillNetTotal(bill)}
                          currency={currency}
                          emphasis
                        />
                      </td>
                      <td className="px-3 py-3">
                        <PriceDisplay
                          value={getBillNetProfit(bill)}
                          currency={currency}
                          className="text-green-700"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone="neutral">
                          {t(
                            `common.${bill.paymentMethod}` as Parameters<
                              typeof t
                            >[0],
                          )}
                        </Badge>
                      </td>
                      <td className="px-3 py-3">
                        <StatusPill
                          status={bill.status}
                          tone={billTone(bill.status)}
                          label={t(
                            `common.${bill.status}` as Parameters<typeof t>[0],
                          )}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <SyncBadge status={bill.syncStatus} />
                      </td>
                      <td className="px-3 py-3">
                        <Link
                          href={`/bills/${bill.id}`}
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          {t("bills.viewDetails")}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </TableShell>
    </div>
  );
}
