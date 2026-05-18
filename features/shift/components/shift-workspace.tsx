"use client";

import { useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import { settingsRepo } from "@/lib/db/repositories";
import {
  closeShift,
  computeExpectedCash,
  getActiveShift,
  listShifts,
  openShift,
  summarizeShiftBills,
  summarizeShiftCashOut,
} from "@/lib/services/shift-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { ShiftReport } from "./shift-report";
import type {
  Bill,
  CustomerPayment,
  Purchase,
  Shift,
  SupplierPayment,
} from "@/types/domain";

function dismissOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

export function ShiftWorkspace() {
  const { t /* dir */ } = useLocale();
  const tableLabels = useDataTableLabels();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const activeShift = useLiveQuery(() => getActiveShift(), []);
  const pastShifts = useLiveQuery(() => listShifts(), []);
  // Live-queries on bills so the active-shift expected cash updates as new
  // sales come in. Filter to the active shift's id when it exists.
  const activeShiftBills = useLiveQuery<Bill[]>(
    () =>
      activeShift?.id
        ? db.bills.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<Bill[]>([]),
    [activeShift?.id],
  );
  const activeShiftPurchases = useLiveQuery<Purchase[]>(
    () =>
      activeShift?.id
        ? db.purchases.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<Purchase[]>([]),
    [activeShift?.id],
  );
  const activeShiftSupplierPayments = useLiveQuery<SupplierPayment[]>(
    () =>
      activeShift?.id
        ? db.supplierPayments.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<SupplierPayment[]>([]),
    [activeShift?.id],
  );
  const activeShiftCustomerPayments = useLiveQuery<CustomerPayment[]>(
    () =>
      activeShift?.id
        ? db.customerPayments.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<CustomerPayment[]>([]),
    [activeShift?.id],
  );
  const currency = settings?.currency ?? "USD";

  const [openingCash, setOpeningCash] = useState("");
  const [openNotes, setOpenNotes] = useState("");
  const [cashierName, setCashierName] = useState("");
  useEffect(() => {
    if (settings?.cashierName && !cashierName) {
      setCashierName(settings.cashierName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.cashierName]);
  const [submittingOpen, setSubmittingOpen] = useState(false);

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closingNotes, setClosingNotes] = useState("");
  const [submittingClose, setSubmittingClose] = useState(false);

  const [reportShift, setReportShift] = useState<Shift | null>(null);

  const totals = useMemo(
    () => summarizeShiftBills(activeShiftBills ?? []),
    [activeShiftBills],
  );
  const cashOut = useMemo(
    () =>
      summarizeShiftCashOut(
        activeShiftPurchases ?? [],
        activeShiftSupplierPayments ?? [],
      ),
    [activeShiftPurchases, activeShiftSupplierPayments],
  );

  const customerPaymentCashIn = useMemo(() => {
    return (activeShiftCustomerPayments ?? [])
      .filter((p) => !p.paymentMethod || p.paymentMethod === "cash")
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  }, [activeShiftCustomerPayments]);

  const expectedCash = activeShift
    ? (activeShift.openingCash ?? 0) +
      totals.cashCollected +
      customerPaymentCashIn -
      cashOut.totalCashOut
    : 0;

  // Used inside the close dialog to show live counted vs expected diff while
  // the cashier is typing.
  const countedCashNumeric = Number(countedCash);
  const liveDifference = Number.isFinite(countedCashNumeric)
    ? countedCashNumeric - expectedCash
    : 0;

  const closedShifts = useMemo(
    () => (pastShifts ?? []).filter((shift) => shift.status === "closed"),
    [pastShifts],
  );

  const shiftColumns = useMemo<ColumnDef<Shift, unknown>[]>(
    () => [
      {
        accessorKey: "openedAt",
        header: t("shift.openedAt"),
        cell: ({ row }) => (
          <span className="text-slate-700">
            {formatDateTime(row.original.openedAt)}
          </span>
        ),
      },
      {
        accessorKey: "openedByCashierName",
        header: t("shift.openedBy"),
        cell: ({ row }) => (
          <span className="text-slate-700">
            {row.original.openedByCashierName}
          </span>
        ),
      },
      {
        accessorKey: "openingCash",
        header: t("shift.openingCash"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.openingCash, currency)}
          </span>
        ),
      },
      {
        accessorKey: "expectedCash",
        header: t("shift.expectedCash"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.expectedCash ?? 0, currency)}
          </span>
        ),
      },
      {
        accessorKey: "countedCash",
        header: t("shift.countedCash"),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatCurrency(row.original.countedCash ?? 0, currency)}
          </span>
        ),
      },
      {
        accessorKey: "cashDifference",
        header: t("shift.cashDifference"),
        cell: ({ row }) => {
          const diff = row.original.cashDifference ?? 0;
          return (
            <span
              className={`font-semibold tabular-nums ${diff > 0.005 ? "text-emerald-700" : diff < -0.005 ? "text-red-700" : "text-slate-700"}`}
            >
              {formatCurrency(diff, currency)}
            </span>
          );
        },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="block text-end">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setReportShift(row.original)}
            >
              {t("shift.viewReport")}
            </Button>
          </span>
        ),
      },
    ],
    [currency, t],
  );

  async function handleOpenShift() {
    if (submittingOpen) return;
    setSubmittingOpen(true);
    try {
      await openShift({
        openingCash: Number(openingCash || 0),
        cashierName: (cashierName || settings?.cashierName || "Owner").trim(),
        notes: openNotes,
      });
      setOpeningCash("");
      setOpenNotes("");
      setCashierName("");
      push(t("shift.openShiftSuccess"));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("shift.openShiftFailed"),
        "error",
      );
    } finally {
      setSubmittingOpen(false);
    }
  }

  async function handleCloseShift() {
    if (!activeShift || submittingClose) return;
    setSubmittingClose(true);
    try {
      const closed = await closeShift({
        shiftId: activeShift.id,
        countedCash: Number(countedCash || 0),
        notes: closingNotes,
      });
      setCloseDialogOpen(false);
      setCountedCash("");
      setClosingNotes("");
      push(t("shift.closeShiftSuccess"));
      setReportShift(closed);
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("shift.closeShiftFailed"),
        "error",
      );
    } finally {
      setSubmittingClose(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title={t("shift.title")} description={t("shift.subtitle")} />

      {activeShift === undefined ? null : activeShift === null ? (
        // ── No active shift: show the open-shift form ──────────────────
        <Card className="flex flex-col gap-4" padding="md">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t("shift.noActiveShift")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("shift.noActiveShiftDesc")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                {t("shift.openingCash")}
              </span>
              <Input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="0.01"
                min="0"
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
                onKeyDown={dismissOnEnter}
                placeholder="0.00"
              />
              <span className="text-xs text-slate-500">
                {t("shift.openingCashHelper")}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                {t("shift.cashierName")}
              </span>
              <Input
                value={cashierName}
                onChange={(e) => setCashierName(e.target.value)}
                placeholder={settings?.cashierName || "Owner"}
              />
              <span className="text-xs text-slate-500">
                {t("shift.cashierNameHelper")}
              </span>
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
              {t("shift.openShiftNotes")}
            </span>
            <Input
              value={openNotes}
              onChange={(e) => setOpenNotes(e.target.value)}
              placeholder={t("shift.openShiftNotesPlaceholder")}
            />
          </label>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleOpenShift}
              disabled={submittingOpen}
            >
              {t("shift.openShiftCta")}
            </Button>
          </div>
        </Card>
      ) : (
        // ── Active shift: live summary + close button ──────────────────
        <Card className="flex flex-col gap-4" padding="md">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {t("shift.activeShift")}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {t("shift.openedAt")}: {formatDateTime(activeShift.openedAt)} ·{" "}
                {t("shift.openedBy")}: {activeShift.openedByCashierName}
              </p>
            </div>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setCountedCash(expectedCash.toFixed(2));
                setCloseDialogOpen(true);
              }}
            >
              {t("shift.closeShift")}
            </Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={t("shift.openingCash")}
              value={formatCurrency(activeShift.openingCash, currency)}
            />
            <StatCard
              label={t("shift.cashCollected")}
              value={formatCurrency(totals.cashCollected, currency)}
            />
            <StatCard
              label={t("shift.cashPaidOut")}
              value={formatCurrency(cashOut.totalCashOut, currency)}
              helper={t("shift.cashPaidOutHelper")}
              tone={cashOut.totalCashOut > 0.005 ? "warning" : "neutral"}
            />
            <StatCard
              label={t("shift.expectedCash")}
              value={formatCurrency(expectedCash, currency)}
              helper={t("shift.expectedCashHelper")}
              tone="positive"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label={t("shift.billsInShift")}
              value={String(totals.billCount)}
            />
            <StatCard
              label={t("shift.itemsInShift")}
              value={String(totals.itemCount)}
            />
            <StatCard
              label={t("shift.purchasesInShift")}
              value={String(cashOut.purchaseCount)}
              helper={formatCurrency(cashOut.purchaseCashOut, currency)}
            />
            <StatCard
              label={t("shift.paymentsInShift")}
              value={String(cashOut.supplierPaymentCount)}
              helper={formatCurrency(cashOut.supplierPaymentCashOut, currency)}
            />
          </div>

          {(totals.voidedBillCount > 0 || totals.returnedBillCount > 0) && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard
                label={t("shift.creditAccrued")}
                value={formatCurrency(totals.creditAccrued, currency)}
              />
              <StatCard
                label={t("shift.voidedCount")}
                value={String(totals.voidedBillCount)}
              />
              <StatCard
                label={t("shift.returnedCount")}
                value={String(totals.returnedBillCount)}
              />
            </div>
          )}

          {activeShift.notes && (
            <p className="text-xs text-slate-500 italic">
              &ldquo;{activeShift.notes}&rdquo;
            </p>
          )}
        </Card>
      )}

      {/* ── Past shifts history ────────────────────────────────────────── */}
      <Card padding="md">
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              {t("shift.history")}
            </h2>
            <p className="text-sm text-slate-500">{t("shift.historyDesc")}</p>
          </div>
        </div>

        {closedShifts.length === 0 ? (
          <EmptyState
            title={t("shift.noPastShifts")}
            description={t("shift.history")}
          />
        ) : (
          <DataTable
            columns={shiftColumns}
            data={closedShifts}
            enableGlobalSearch
            emptyTitle={t("shift.noPastShifts")}
            pageSize={10}
            labels={tableLabels}
          />
        )}
      </Card>

      {/* ── Close-shift dialog ────────────────────────────────────────── */}
      <Modal
        open={closeDialogOpen}
        title={t("shift.closeShift")}
        description={t("shift.closeShiftDesc")}
        onClose={() => setCloseDialogOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setCloseDialogOpen(false)}
              disabled={submittingClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleCloseShift}
              disabled={submittingClose}
            >
              {t("shift.confirmClose")}
            </Button>
          </>
        }
      >
        {activeShift && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label={t("shift.expectedCash")}
                value={formatCurrency(expectedCash, currency)}
              />
              <StatCard
                label={t("shift.cashDifference")}
                value={formatCurrency(liveDifference, currency)}
                tone={
                  liveDifference > 0.005
                    ? "positive"
                    : liveDifference < -0.005
                      ? "warning"
                      : "neutral"
                }
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                {t("shift.countedCash")}
              </span>
              <Input
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="0.01"
                min="0"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                onKeyDown={dismissOnEnter}
              />
              <span className="text-xs text-slate-500">
                {t("shift.countedCashHelper")}
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                {t("shift.closingNotes")}
              </span>
              <Input
                value={closingNotes}
                onChange={(e) => setClosingNotes(e.target.value)}
              />
            </label>
          </div>
        )}
      </Modal>

      {/* ── Shift report viewer ───────────────────────────────────────── */}
      <Modal
        open={reportShift !== null}
        title={t("shift.viewReport")}
        onClose={() => setReportShift(null)}
        footer={
          <Button
            type="button"
            variant="ghost"
            onClick={() => setReportShift(null)}
          >
            {t("common.close")}
          </Button>
        }
      >
        {reportShift && <ShiftReport shift={reportShift} settings={settings} />}
      </Modal>
    </PageShell>
  );
}

// Stub re-export so the route file can import a single name even before the
// real report lands (D6 fills it in). Keeps the workspace import stable.
export { computeExpectedCash };
