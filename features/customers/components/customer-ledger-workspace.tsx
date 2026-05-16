"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db/schema";
import {
  getCustomerLedger,
  getCustomerLedgerDetails,
  recordCustomerPayment,
  type CustomerLedgerDetails,
  type CustomerLedgerRow,
} from "@/lib/services/customer-ledger-service";
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

export function CustomerLedgerWorkspace() {
  const { t, dir } = useLocale();
  const { push } = useToast();
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const ledger = useLiveQuery(() => getCustomerLedger(), []);
  const activeShift = useLiveQuery(
    () => db.shifts.where("status").equals("open").first(),
    [],
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CustomerLedgerDetails | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const currency = settings?.currency ?? "USD";

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
          creditSales: acc.creditSales + row.creditSales,
          payments: acc.payments + row.paidOnBills + row.payments,
          balanceDue: acc.balanceDue + row.balanceDue,
          customersWithDebt:
            acc.customersWithDebt + (row.balanceDue > 0.001 ? 1 : 0),
        }),
        { creditSales: 0, payments: 0, balanceDue: 0, customersWithDebt: 0 },
      ),
    [rows],
  );

  const paymentAmountNumeric = Number(amount);
  const safePaymentAmount = Number.isFinite(paymentAmountNumeric)
    ? paymentAmountNumeric
    : 0;
  const balanceDueAtModal = selected?.balanceDue ?? 0;
  // Only treat amounts above an existing positive balance as overpayments;
  // a payment toward an already-credit customer (balanceDue <= 0) is
  // always a deposit on top of credit.
  const overpaymentExtra =
    safePaymentAmount > Math.max(0, balanceDueAtModal)
      ? safePaymentAmount - Math.max(0, balanceDueAtModal)
      : 0;
  const isOverpayment = overpaymentExtra > 0.005;

  async function openDetails(row: CustomerLedgerRow) {
    const details = await getCustomerLedgerDetails(row.key);
    setSelected(details);
  }

  async function savePayment() {
    if (!selected) return;
    try {
      await recordCustomerPayment({
        customerKey: selected.key,
        customerName: selected.name,
        customerPhone: selected.phone,
        amount: Number(amount),
        note,
        paymentMethod,
        shiftId: activeShift?.id,
      });
      const details = await getCustomerLedgerDetails(selected.key);
      setSelected(details);
      setPaymentOpen(false);
      setAmount("");
      setNote("");
      setPaymentMethod("cash");
      push(t("customers.paymentSaved"));
    } catch (error) {
      push(
        error instanceof Error ? error.message : t("customers.paymentFailed"),
        "error",
      );
    }
  }

  const tableToolbar = (
    <Toolbar align="end" className="w-full sm:w-auto">
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("customers.searchPlaceholder")}
        inputSize="sm"
        className="min-w-[220px] sm:min-w-[280px]"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setSearch("")}
      >
        {t("customers.showAll")}
      </Button>
    </Toolbar>
  );

  return (
    <div className="space-y-5" dir={dir}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LedgerStatCard
          label={t("customers.totalCreditSales")}
          value={totals.creditSales}
          currency={currency}
        />
        <LedgerStatCard
          label={t("customers.totalPaid")}
          value={totals.payments}
          currency={currency}
          tone="success"
        />
        <LedgerStatCard
          label={t("customers.totalBalanceDue")}
          value={totals.balanceDue}
          currency={currency}
          tone={totals.balanceDue > 0.005 ? "danger" : "success"}
        />
        <LedgerStatCard
          label={t("customers.customersWithDebt")}
          value={totals.customersWithDebt}
          currency={currency}
          money={false}
          tone={totals.customersWithDebt > 0 ? "warning" : "success"}
        />
      </div>

      <TableShell
        title={t("customers.ledger")}
        description={t("customers.ledgerDesc")}
        toolbar={tableToolbar}
        loading={!ledger}
        empty={
          ledger && filteredRows.length === 0 ? (
            <EmptyState
              compact
              title={t("customers.noCustomers")}
              description={t("customers.noCustomersDesc")}
            />
          ) : undefined
        }
      >
        <table className="min-w-[820px] w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {[
                t("customers.customer"),
                t("customers.phone"),
                t("customers.creditSales"),
                t("customers.paid"),
                t("customers.balanceDue"),
                t("customers.bills"),
                t("customers.lastActivity"),
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
                  <PriceDisplay value={row.creditSales} currency={currency} />
                </td>
                <td className="px-3 py-3">
                  <PriceDisplay
                    value={row.paidOnBills + row.payments}
                    currency={currency}
                  />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriceDisplay
                      value={row.balanceDue}
                      currency={currency}
                      emphasis
                      className={
                        row.balanceDue > 0.005
                          ? "text-red-700"
                          : row.balanceDue < -0.005
                            ? "text-blue-700"
                            : "text-green-700"
                      }
                    />
                    {Math.abs(row.balanceDue) > 0.005 && (
                      <BalanceBadge
                        balance={row.balanceDue}
                        debtLabel={t("customers.balanceDue")}
                        creditLabel={t("customers.creditBalanceNote")}
                      />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums">{row.billCount}</td>
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
                    {t("customers.view")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <Modal
        open={Boolean(selected)}
        title={selected?.name ?? t("customers.customerDetails")}
        description={selected?.phone ?? t("customers.customerDetailsDesc")}
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
                {t("customers.recordPayment")}
              </Button>
            )}
          </>
        }
      >
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <LedgerStatCard
                label={t("customers.creditSales")}
                value={selected.creditSales}
                currency={currency}
              />
              <LedgerStatCard
                label={t("customers.paid")}
                value={selected.paidOnBills + selected.payments}
                currency={currency}
                tone="success"
              />
              <LedgerStatCard
                label={t("customers.balanceDue")}
                value={selected.balanceDue}
                currency={currency}
                tone={selected.balanceDue > 0.005 ? "danger" : "success"}
              />
            </div>

            <SectionCard title={t("customers.creditBills")} padding="sm">
              <div className="max-h-56 space-y-2 overflow-y-auto pe-1">
                {selected.bills.length === 0 ? (
                  <EmptyState compact title={t("customers.noCreditBills")} />
                ) : (
                  selected.bills.map((bill) => {
                    const netTotal = Math.max(
                      0,
                      bill.totalAmount - (bill.returnedAmount ?? 0),
                    );
                    const due = Math.max(0, netTotal - bill.paidAmount);
                    return (
                      <div
                        key={bill.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                      >
                        <div>
                          <Link
                            href={`/bills/${bill.id}` as any}
                            className="font-medium text-blue-700 hover:underline"
                          >
                            {bill.billNumber}
                          </Link>
                          <p className={typographyClasses.hint}>
                            {new Date(bill.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="text-end text-sm tabular-nums">
                          <PriceDisplay value={netTotal} currency={currency} />
                          <p className="mt-1 flex items-center justify-end gap-1 text-red-700">
                            <span>{t("customers.due")}:</span>
                            <PriceDisplay
                              value={due}
                              currency={currency}
                              className="text-red-700"
                            />
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </SectionCard>

            <SectionCard title={t("customers.payments")} padding="sm">
              <div className="max-h-44 space-y-2 overflow-y-auto pe-1">
                {selected.paymentRows.length === 0 ? (
                  <EmptyState compact title={t("customers.noPayments")} />
                ) : (
                  selected.paymentRows.map((payment) => (
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
                          {payment.note || t("customers.payment")}
                        </p>
                      </div>
                      <p className={typographyClasses.hint}>
                        {new Date(payment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        )}
      </Modal>

      <Modal
        open={paymentOpen}
        title={t("customers.recordPayment")}
        description={
          selected
            ? t("customers.recordPaymentDesc", { name: selected.name })
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
                ? t("customers.savePaymentCredit")
                : t("customers.savePayment")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {selected && (
            <SectionCard
              padding="sm"
              tone={selected.balanceDue > 0.005 ? "warning" : "neutral"}
            >
              <div className="flex items-center justify-between gap-3">
                <span className={typographyClasses.label}>
                  {t("customers.balanceDue")}
                </span>
                <PriceDisplay
                  value={selected.balanceDue}
                  currency={currency}
                  emphasis
                />
              </div>
            </SectionCard>
          )}

          <FormField label={t("customers.paymentAmount")}>
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
              {t("customers.overpaymentWarning", {
                extra: formatCurrency(overpaymentExtra, currency),
              })}
            </Badge>
          )}

          <FormField label={t("customers.paymentMethod")}>
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

          <FormField label={t("customers.note")}>
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("customers.notePlaceholder")}
            />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}
