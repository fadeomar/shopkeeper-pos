"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  getSupplierLedger,
  getSupplierLedgerDetails,
  recordSupplierPayment,
  type SupplierLedgerDetails,
  type SupplierLedgerRow,
} from "@/lib/services/supplier-ledger-service";
import { useLocale } from "@/components/providers/locale-context";
import { useToast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { SectionCard } from "@/components/ui/section-card";
import { Select } from "@/components/ui/select";
import { TableShell } from "@/components/ui/table-shell";
import { Toolbar } from "@/components/ui/toolbar";
import { PriceDisplay } from "@/components/pos/price-display";
import { formatCurrency } from "@/lib/utils/money";
import { settingsRepo } from "@/lib/db/repositories";
import { typographyClasses } from "@/lib/design/variants";

type PaymentMethod = "cash" | "card" | "bank" | "other";

function LedgerStatCard({
  label,
  value,
  currency,
  helper,
  tone = "neutral",
  money = true,
}: {
  label: string;
  value: number;
  currency: string;
  helper?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  money?: boolean;
}) {
  return (
    <SectionCard padding="sm" tone={tone} className="gap-2">
      <p className={typographyClasses.statLabel}>{label}</p>
      {money ? (
        <PriceDisplay
          value={value}
          currency={currency}
          size="xl"
          emphasis
          className={typographyClasses.statValue}
        />
      ) : (
        <p className={`${typographyClasses.statValue} tabular-nums`}>{value}</p>
      )}
      {helper && <p className={typographyClasses.statHelper}>{helper}</p>}
    </SectionCard>
  );
}

function BalanceBadge({
  balance,
  debtLabel,
  creditLabel,
}: {
  balance: number;
  debtLabel: string;
  creditLabel: string;
}) {
  if (balance > 0.005) {
    return <Badge tone="danger">{debtLabel}</Badge>;
  }

  if (balance < -0.005) {
    return <Badge tone="info">{creditLabel}</Badge>;
  }

  return null;
}

export function SupplierLedgerWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getSupplierLedger(), []);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SupplierLedgerDetails | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const currency = settings?.currency ?? "USD";

  const paymentAmountNumeric = Number(amount);
  const safePaymentAmount = Number.isFinite(paymentAmountNumeric)
    ? paymentAmountNumeric
    : 0;
  const balanceOwedAtModal = selected?.balanceOwed ?? 0;
  // Mirror of customer overpayment math: only amounts above a positive
  // outstanding balance count as overpayment. Paying a supplier we already
  // owe nothing is automatically a deposit/credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceOwedAtModal)
      ? safePaymentAmount - Math.max(0, balanceOwedAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > 0.005;

  async function savePayment() {
    if (!selected) return;
    try {
      await recordSupplierPayment({
        supplierKey: selected.key,
        supplierName: selected.name,
        supplierPhone: selected.phone,
        amount: Number(amount),
        note,
        paymentMethod,
      });
      const details = await getSupplierLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount("");
      setNote("");
      setPaymentMethod("cash");
      push(t("suppliers.paymentSaved"));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("suppliers.paymentFailed"),
        "error",
      );
    }
  }

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
          totalPurchases: acc.totalPurchases + row.totalPurchases,
          payments: acc.payments + row.paidOnPurchases + row.payments,
          balanceOwed: acc.balanceOwed + row.balanceOwed,
          suppliersWithDebt:
            acc.suppliersWithDebt + (row.balanceOwed > 0.001 ? 1 : 0),
        }),
        {
          totalPurchases: 0,
          payments: 0,
          balanceOwed: 0,
          suppliersWithDebt: 0,
        },
      ),
    [rows],
  );

  async function openDetails(row: SupplierLedgerRow) {
    const details = await getSupplierLedgerDetails(row.key);
    setSelected(details);
  }

  const tableToolbar = (
    <Toolbar align="end" className="w-full sm:w-auto">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("suppliers.searchPlaceholder")}
        inputSize="sm"
        className="min-w-[220px] sm:min-w-[280px]"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setSearch("")}
      >
        {t("suppliers.showAll")}
      </Button>
    </Toolbar>
  );

  return (
    <div className="space-y-5" dir={dir}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LedgerStatCard
          label={t("suppliers.totalPurchases")}
          value={totals.totalPurchases}
          currency={currency}
        />
        <LedgerStatCard
          label={t("suppliers.totalPaid")}
          value={totals.payments}
          currency={currency}
          tone="success"
        />
        <LedgerStatCard
          label={t("suppliers.totalBalanceOwed")}
          value={totals.balanceOwed}
          currency={currency}
          tone={totals.balanceOwed > 0.005 ? "danger" : "success"}
        />
        <LedgerStatCard
          label={t("suppliers.suppliersWithDebt")}
          value={totals.suppliersWithDebt}
          currency={currency}
          money={false}
          tone={totals.suppliersWithDebt > 0 ? "warning" : "success"}
        />
      </div>

      <TableShell
        title={t("suppliers.ledger")}
        description={t("suppliers.ledgerDesc")}
        toolbar={tableToolbar}
        loading={!ledger}
        empty={
          ledger && filteredRows.length === 0 ? (
            <EmptyState
              compact
              title={t("suppliers.noSuppliers")}
              description={t("suppliers.noSuppliersDesc")}
            />
          ) : undefined
        }
      >
        <table className="min-w-[820px] w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {[
                t("suppliers.supplier"),
                t("suppliers.phone"),
                t("suppliers.creditPurchases"),
                t("suppliers.paid"),
                t("suppliers.balanceOwed"),
                t("suppliers.purchaseCount"),
                t("suppliers.lastActivity"),
                "",
              ].map((head) => (
                <th key={head} className={typographyClasses.tableHeader}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.map((row) => (
              <tr key={row.key} className="hover:bg-slate-50/60">
                <td className={typographyClasses.tableCellStrong}>
                  {row.name}
                </td>
                <td className={typographyClasses.tableCellMuted}>
                  {row.phone || "—"}
                </td>
                <td className="px-3 py-3">
                  <PriceDisplay
                    value={row.creditPurchases}
                    currency={currency}
                  />
                </td>
                <td className="px-3 py-3">
                  <PriceDisplay
                    value={row.paidOnPurchases + row.payments}
                    currency={currency}
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriceDisplay
                      value={row.balanceOwed}
                      currency={currency}
                      emphasis
                      className={
                        row.balanceOwed > 0.005
                          ? "text-red-700"
                          : row.balanceOwed < -0.005
                            ? "text-blue-700"
                            : "text-green-700"
                      }
                    />
                    {Math.abs(row.balanceOwed) > 0.005 && (
                      <BalanceBadge
                        balance={row.balanceOwed}
                        debtLabel={t("suppliers.creditBalanceNote")}
                        creditLabel={t("common.credit")}
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums">{row.purchaseCount}</td>
                <td className={typographyClasses.tableCellMuted}>
                  {row.lastActivityAt
                    ? new Date(row.lastActivityAt).toLocaleString()
                    : "—"}
                </td>
                <td className="px-3 py-3 text-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => openDetails(row)}
                  >
                    {t("suppliers.view")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <Modal
        open={Boolean(selected)}
        title={selected?.name ?? t("suppliers.supplierDetails")}
        description={selected?.phone ?? t("suppliers.supplierDetailsDesc")}
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
                {t("suppliers.recordPayment")}
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LedgerStatCard
                label={t("suppliers.creditPurchases")}
                value={selected.creditPurchases}
                currency={currency}
              />
              <LedgerStatCard
                label={t("suppliers.paid")}
                value={selected.paidOnPurchases + selected.payments}
                currency={currency}
                tone="success"
              />
              <LedgerStatCard
                label={t("suppliers.balanceOwed")}
                value={selected.balanceOwed}
                currency={currency}
                tone={selected.balanceOwed > 0.005 ? "danger" : "success"}
              />
            </div>

            <SectionCard title={t("suppliers.purchases")} padding="sm">
              {selected.purchases.length === 0 ? (
                <EmptyState compact title={t("suppliers.noPurchases")} />
              ) : (
                <div className="max-h-56 space-y-2 overflow-y-auto pe-1">
                  {selected.purchases.map((purchase) => (
                    <div
                      key={purchase.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {purchase.purchaseNumber}
                        </p>
                        <p className={typographyClasses.hint}>
                          {new Date(purchase.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="text-end text-sm tabular-nums">
                        <PriceDisplay
                          value={purchase.totalAmount}
                          currency={currency}
                        />
                        {purchase.creditAmount > 0.005 && (
                          <p className="mt-1">
                            <PriceDisplay
                              value={purchase.creditAmount}
                              currency={currency}
                              className="text-red-700"
                            />
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title={t("suppliers.payments")} padding="sm">
              {selected.paymentRows.length === 0 ? (
                <EmptyState compact title={t("suppliers.noPayments")} />
              ) : (
                <div className="max-h-44 space-y-2 overflow-y-auto pe-1">
                  {selected.paymentRows.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                    >
                      <div>
                        <PriceDisplay
                          value={payment.amount}
                          currency={currency}
                          emphasis
                        />
                        <p className={typographyClasses.hint}>
                          {payment.note || "—"}
                        </p>
                      </div>
                      <p className={typographyClasses.hint}>
                        {new Date(payment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </Modal>

      <Modal
        open={paymentOpen}
        title={t("suppliers.recordPayment")}
        description={
          selected
            ? t("suppliers.recordPaymentDesc", { name: selected.name })
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
                ? t("suppliers.savePaymentCredit")
                : t("suppliers.savePayment")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {selected && (
            <SectionCard
              padding="sm"
              tone={selected.balanceOwed > 0.005 ? "warning" : "neutral"}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={typographyClasses.label}>
                  {t("suppliers.balanceOwed")}
                </span>
                <PriceDisplay
                  value={selected.balanceOwed}
                  currency={currency}
                  emphasis
                />
              </div>
            </SectionCard>
          )}

          <FormField label={t("suppliers.paymentAmount")}>
            <Input
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              step="0.01"
              min="0"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormField>

          {isOverpayment && (
            <Badge tone="warning" className="whitespace-normal text-start">
              {t("suppliers.overpaymentWarning", {
                extra: formatCurrency(overpaymentExtra, currency),
              })}
            </Badge>
          )}

          <FormField label={t("suppliers.paymentMethod")}>
            <Select
              value={paymentMethod}
              onChange={(event) =>
                setPaymentMethod(event.target.value as PaymentMethod)
              }
            >
              {(["cash", "card", "bank", "other"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`common.${m}`)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label={t("suppliers.note")}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("suppliers.notePlaceholder")}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
