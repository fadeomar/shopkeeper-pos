"use client";

import { useEffect, useMemo, useState } from "react";
import { getServiceErrorMessage } from "@/lib/errors/get-error-message";
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
  summarizeShiftCash,
} from "@/lib/services/shift-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Card } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, useDataTableLabels } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { useLocale } from "@/components/providers/locale-context";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { formatCurrency, MONEY_EPSILON } from "@/lib/utils/money";
import { formatDateTime } from "@/lib/utils/date";
import { ShiftReport } from "./shift-report";
import type {
  Bill,
  CashMovement,
  CustomerPayment,
  Expense,
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
  // Manual cash movements + cash expenses also move the drawer. Live-querying
  // them by shiftId is what makes the expected-cash card update the instant the
  // cashier records an expense or a manual cash in/out.
  const activeShiftCashMovements = useLiveQuery<CashMovement[]>(
    () =>
      activeShift?.id
        ? db.cashMovements.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<CashMovement[]>([]),
    [activeShift?.id],
  );
  const activeShiftExpenses = useLiveQuery<Expense[]>(
    () =>
      activeShift?.id
        ? db.expenses.where("shiftId").equals(activeShift.id).toArray()
        : Promise.resolve<Expense[]>([]),
    [activeShift?.id],
  );
  const currency = settings?.currency ?? "ILS";

  const [openingCash, setOpeningCash] = useState<number>(0);
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
  const [countedCash, setCountedCash] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState("");
  const [submittingClose, setSubmittingClose] = useState(false);

  const [reportShift, setReportShift] = useState<Shift | null>(null);

  // Single shared helper — identical math to closeShift(), so the live summary
  // and the final close calculation can never diverge.
  const cashSummary = useMemo(
    () =>
      summarizeShiftCash(
        { openingCash: activeShift?.openingCash ?? 0 },
        {
          bills: activeShiftBills ?? [],
          purchases: activeShiftPurchases ?? [],
          supplierPayments: activeShiftSupplierPayments ?? [],
          customerPayments: activeShiftCustomerPayments ?? [],
          cashMovements: activeShiftCashMovements ?? [],
          expenses: activeShiftExpenses ?? [],
        },
      ),
    [
      activeShift?.openingCash,
      activeShiftBills,
      activeShiftPurchases,
      activeShiftSupplierPayments,
      activeShiftCustomerPayments,
      activeShiftCashMovements,
      activeShiftExpenses,
    ],
  );
  const {
    totals,
    cashOut,
    customerPaymentCashIn,
    cashMovementNet,
    cashExpensesTotal,
  } = cashSummary;
  const expectedCash = activeShift ? cashSummary.expectedCash : 0;

  // Used inside the close dialog to show live counted vs expected diff while
  // the cashier is typing.
  const liveDifference = Number.isFinite(countedCash)
    ? countedCash - expectedCash
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
          <span className="whitespace-nowrap text-slate-700">
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
              className={`font-semibold tabular-nums ${diff > MONEY_EPSILON ? "text-success" : diff < -MONEY_EPSILON ? "text-danger" : "text-slate-700"}`}
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
        openingCash: openingCash || 0,
        cashierName: (
          cashierName ||
          settings?.cashierName ||
          t("common.owner")
        ).trim(),
        notes: openNotes,
      });
      setOpeningCash(0);
      setOpenNotes("");
      setCashierName("");
      push(t("shift.openShiftSuccess"));
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("shift.openShiftFailed")),
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
        countedCash: countedCash || 0,
        notes: closingNotes,
      });
      setCloseDialogOpen(false);
      setCountedCash(0);
      setClosingNotes("");
      push(t("shift.closeShiftSuccess"));
      setReportShift(closed);
    } catch (error) {
      push(
        getServiceErrorMessage(error, t, t("shift.closeShiftFailed")),
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
              <MoneyInput
                value={openingCash}
                onValueChange={setOpeningCash}
                currency={currency}
                min={0}
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
                placeholder={settings?.cashierName || t("common.owner")}
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
                setCountedCash(expectedCash);
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
              tone={
                cashOut.totalCashOut > MONEY_EPSILON ? "warning" : "neutral"
              }
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

          {/* Drawer adjustments that also feed expected cash — surfaced so the
              cashier can see why the expected total moved. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard
              label={t("shift.customerCashPayments")}
              value={formatCurrency(customerPaymentCashIn, currency)}
              tone={
                customerPaymentCashIn > MONEY_EPSILON ? "positive" : "neutral"
              }
            />
            <StatCard
              label={t("shift.manualCashNet")}
              value={formatCurrency(cashMovementNet, currency)}
              tone={
                cashMovementNet > MONEY_EPSILON
                  ? "positive"
                  : cashMovementNet < -MONEY_EPSILON
                    ? "warning"
                    : "neutral"
              }
            />
            <StatCard
              label={t("shift.cashExpenses")}
              value={formatCurrency(cashExpensesTotal, currency)}
              tone={cashExpensesTotal > MONEY_EPSILON ? "warning" : "neutral"}
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
                  liveDifference > MONEY_EPSILON
                    ? "positive"
                    : liveDifference < -MONEY_EPSILON
                      ? "warning"
                      : "neutral"
                }
              />
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">
                {t("shift.countedCash")}
              </span>
              <MoneyInput
                value={countedCash}
                onValueChange={setCountedCash}
                currency={currency}
                min={0}
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
