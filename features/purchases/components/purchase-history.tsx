"use client";

/**
 * PurchaseHistory — read-only list of past purchase invoices (the buy-side
 * mirror of the bills table). Reads db.purchases via useLiveQuery so it stays
 * current, and reuses the shared DataTable for search + pagination.
 *
 * This backs the /purchases route, which the purchase-entry success card links
 * to as "Purchase history". Before this existed that link 404'd.
 */

import { useMemo } from "react";
import clsx from "clsx";
import { useLiveQuery } from "dexie-react-hooks";
import type { ColumnDef } from "@tanstack/react-table";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import { formatDateTime } from "@/lib/utils/date";
import { formatCurrency } from "@/lib/utils/money";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { RecordSyncBadge } from "@/components/sync/record-sync-badge";
import { useLocale } from "@/components/providers/locale-context";
import type { Purchase } from "@/types/domain";

export function PurchaseHistory() {
  const { t } = useLocale();
  const labels = useDataTableLabels();
  const purchases = useLiveQuery(
    () => db.purchases.orderBy("createdAt").reverse().toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const currency = settings?.currency ?? "ILS";

  const columns = useMemo<ColumnDef<Purchase>[]>(
    () => [
      {
        header: t("purchases.purchaseNumber"),
        accessorKey: "purchaseNumber",
        cell: ({ row }) => (
          <span className="font-medium text-slate-800 tabular-nums">
            {row.original.purchaseNumber}
          </span>
        ),
      },
      {
        header: t("bills.dateTime"),
        accessorKey: "createdAt",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-slate-600">
            {formatDateTime(row.original.createdAt)}
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
            row.original.totalAmount - row.original.paidAmount,
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
    <DataTable
      columns={columns}
      data={purchases}
      enableGlobalSearch
      emptyTitle={t("purchases.noPurchases")}
      pageSize={10}
      labels={labels}
      getRowId={(row) => row.id}
    />
  );
}
