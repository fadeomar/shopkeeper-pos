"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import type { SyncStatus } from "@/types/domain";

function SyncBadge({ status }: { status?: SyncStatus }) {
  const { t } = useLocale();
  const effective = status ?? "synced";
  const styles: Record<SyncStatus, string> = {
    synced: "bg-green-50 text-green-700 border-green-100",
    pending: "bg-amber-50 text-amber-700 border-amber-100",
    syncing: "bg-blue-50 text-blue-700 border-blue-100",
    failed: "bg-red-50 text-red-700 border-red-100",
    conflict: "bg-amber-100 text-amber-800 border-amber-200",
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
              {filteredBills.map((bill) => (
                <Link key={bill.id} href={`/bills/${bill.id}`} className="touch-card block rounded-2xl border border-slate-200 bg-white p-3 shadow-xs active:bg-slate-50">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 tabular-nums">{bill.billNumber}</p>
                      <p className="text-xs text-slate-500 tabular-nums">{formatDateTime(bill.createdAt)}</p>
                    </div>
                    <SyncBadge status={bill.syncStatus} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-slate-500">{t('bills.total')}</p><p className="font-black text-slate-900 tabular-nums">{formatCurrency(getBillNetTotal(bill), currency)}</p></div>
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-slate-500">{t('bills.profit')}</p><p className="font-bold text-green-700 tabular-nums">{formatCurrency(getBillNetProfit(bill), currency)}</p></div>
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-slate-500">{t('bills.itemCount')}</p><p className="font-bold text-slate-800 tabular-nums">{bill.itemCount}</p></div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="truncate">{bill.customerName || t('common.walkin')}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{t(`common.${bill.paymentMethod}` as Parameters<typeof t>[0])}</span>
                  </div>
                </Link>
              ))}
            </div>

            <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200">
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBills.map((bill) => (
                  <tr
                    key={bill.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="px-3 py-3 font-medium text-slate-800 tabular-nums">
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
                    <td className="px-3 py-3 font-semibold text-slate-800 tabular-nums">
                      {formatCurrency(getBillNetTotal(bill), currency)}
                    </td>
                    <td className="px-3 py-3 text-green-600 font-medium tabular-nums">
                      {formatCurrency(getBillNetProfit(bill), currency)}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 capitalize">
                        {t(
                          `common.${bill.paymentMethod}` as Parameters<
                            typeof t
                          >[0],
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={clsx(
                          "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                          bill.status === "finalized"
                            ? "bg-green-100 text-green-700"
                            : bill.status === "voided"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {t(`common.${bill.status}` as Parameters<typeof t>[0])}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <SyncBadge status={bill.syncStatus} />
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/bills/${bill.id}`}
                        className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 transition-colors"
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
      </Card>
    </div>
  );
}
