'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { billFormSchema, type BillFormSchema } from '@/features/bills/schema';
import { calculateBillTotals, calculateChange } from '@/lib/utils/calculations';
import { formatCurrency } from '@/lib/utils/money';
import { createFinalizedBill } from '@/lib/services/billing-service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { BarcodeScannerModal } from '@/components/barcode/barcode-scanner-modal';
import { useLocale } from '@/components/providers/locale-context';
import { Card } from '@/components/ui/card';
import type { BillDraftItem, Product } from '@/types/domain';

const POS_DRAFT_KEY = 'shopkeeper-pos-bill-draft-v1';

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-600 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function SummaryRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
      <span className={`text-sm ${highlight ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{label}</span>
      <span className={`text-sm tabular-nums ${highlight ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>{value}</span>
    </div>
  );
}

export function PosScreen() {
  const { t } = useLocale();
  const products = useLiveQuery(
    () => db.products.where('status').equals('active').sortBy('name'), [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);
  const { push } = useToast();
  const currency = settings?.currency ?? 'USD';

  const [draftItems, setDraftItems] = useState<BillDraftItem[]>([]);
  const [productId, setProductId] = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [isPaidAmountManuallyEdited, setIsPaidAmountManuallyEdited] = useState(false);

  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const lastAppliedCashierNameRef = useRef('Owner');

  const form = useForm<BillFormSchema>({
    resolver: zodResolver(billFormSchema),
    defaultValues: {
      cashierName: settings?.cashierName ?? 'Owner',
      customerName: '', customerPhone: '', paymentMethod: 'cash',
      discountAmount: 0, taxAmount: 0, paidAmount: 0, notes: '',
    },
  });

  useEffect(() => { barcodeInputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!settings) return;
    const nextDefault = settings.cashierName || 'Owner';
    const current = form.getValues('cashierName');
    if (!current || current === lastAppliedCashierNameRef.current) {
      form.setValue('cashierName', nextDefault, { shouldDirty: false });
    }
    lastAppliedCashierNameRef.current = nextDefault;
  }, [settings, form]);

  // Restore draft from localStorage
  useEffect(() => {
    const raw = window.localStorage.getItem(POS_DRAFT_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { items: BillDraftItem[]; form: BillFormSchema };
      const items = parsed.items ?? [];
      setDraftItems(items);
      form.reset(parsed.form);
      const autoTotal = calculateBillTotals(
        items.map((i) => ({ quantity: i.quantity, unitBuyPrice: i.unitBuyPrice, unitSellPrice: i.unitSellPrice })),
        parsed.form.discountAmount, parsed.form.taxAmount,
      ).totalAmount;
      setIsPaidAmountManuallyEdited(Math.abs(parsed.form.paidAmount - autoTotal) > 0.001);
    } catch {
      window.localStorage.removeItem(POS_DRAFT_KEY);
    }
  }, [form]);

  // Watch all form fields for draft persistence
  const watchedCashierName    = form.watch('cashierName');
  const watchedCustomerName   = form.watch('customerName');
  const watchedCustomerPhone  = form.watch('customerPhone');
  const watchedPaymentMethod  = form.watch('paymentMethod');
  const watchedDiscountAmount = Number(form.watch('discountAmount') || 0);
  const watchedTaxAmount      = Number(form.watch('taxAmount') || 0);
  const watchedPaidAmount     = Number(form.watch('paidAmount') || 0);
  const watchedNotes          = form.watch('notes');

  useEffect(() => {
    const payload = JSON.stringify({
      items: draftItems,
      form: {
        cashierName: watchedCashierName ?? '',
        customerName: watchedCustomerName ?? '',
        customerPhone: watchedCustomerPhone ?? '',
        paymentMethod: watchedPaymentMethod ?? 'cash',
        discountAmount: watchedDiscountAmount,
        taxAmount: watchedTaxAmount,
        paidAmount: watchedPaidAmount,
        notes: watchedNotes ?? '',
      },
    });
    window.localStorage.setItem(POS_DRAFT_KEY, payload);
  }, [draftItems, watchedCashierName, watchedCustomerName, watchedCustomerPhone,
      watchedPaymentMethod, watchedDiscountAmount, watchedTaxAmount, watchedPaidAmount, watchedNotes]);

  const billSummary = useMemo(() =>
    calculateBillTotals(
      draftItems.map((i) => ({ quantity: i.quantity, unitBuyPrice: i.unitBuyPrice, unitSellPrice: i.unitSellPrice })),
      watchedDiscountAmount, watchedTaxAmount,
    ), [draftItems, watchedDiscountAmount, watchedTaxAmount]);

  const expectedPaidAmount = Number(billSummary.totalAmount.toFixed(2));
  const actualPaidAmount   = isPaidAmountManuallyEdited ? watchedPaidAmount : expectedPaidAmount;
  const actualChangeAmount = useMemo(
    () => calculateChange(actualPaidAmount, billSummary.totalAmount),
    [actualPaidAmount, billSummary.totalAmount],
  );

  useEffect(() => {
    if (isPaidAmountManuallyEdited) return;
    form.setValue('paidAmount', expectedPaidAmount, { shouldDirty: false, shouldValidate: true });
  }, [expectedPaidAmount, isPaidAmountManuallyEdited, form]);

  // ── FIXED double-toast: push() is called OUTSIDE setDraftItems updater ──
  function appendProduct(product: Product) {
    if (product.quantityInStock <= 0) {
      push(t('billing.outOfStock'), 'error');
      return;
    }

    const existing = draftItems.find((i) => i.productId === product.id);

    if (existing) {
      const nextQty = Math.min(existing.quantity + 1, product.quantityInStock);
      setDraftItems((cur) =>
        cur.map((i) => i.productId === product.id ? { ...i, quantity: nextQty } : i),
      );
      push(t('billing.itemUpdated', { name: product.name, qty: nextQty }));
    } else {
      const newItem: BillDraftItem = {
        productId: product.id, barcode: product.barcode, name: product.name,
        category: product.category, availableStock: product.quantityInStock,
        quantity: 1, unitBuyPrice: product.buyPrice, unitSellPrice: product.sellPrice,
      };
      setDraftItems((cur) => [...cur, newItem]);
      push(t('billing.itemAdded', { name: product.name }));
    }

    setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function addBySelection() {
    const product = products?.find((p) => p.id === productId);
    if (!product) return;
    appendProduct(product);
    setProductId('');
  }

  function addByBarcode() {
    const bc = barcodeQuery.trim();
    if (!bc) return;
    const product = products?.find((p) => p.barcode === bc);
    if (!product) { push(t('billing.notFound'), 'error'); return; }
    appendProduct(product);
    setBarcodeQuery('');
  }

  function handleScanForBill(barcode: string) {
    const product = products?.find((p) => p.barcode === barcode);
    if (!product) { push(t('billing.notFoundBarcode', { barcode }), 'error'); return; }
    appendProduct(product);
  }

  function updateQuantity(productId: string, quantity: number) {
    setDraftItems((cur) =>
      cur.map((i) => {
        if (i.productId !== productId) return i;
        return { ...i, quantity: Math.max(1, Math.min(quantity, i.availableStock)) };
      }),
    );
  }

  function clearDraft() {
    setDraftItems([]);
    setIsPaidAmountManuallyEdited(false);
    form.reset({
      cashierName: settings?.cashierName ?? 'Owner',
      customerName: '', customerPhone: '', paymentMethod: 'cash',
      discountAmount: 0, taxAmount: 0, paidAmount: 0, notes: '',
    });
    window.localStorage.removeItem(POS_DRAFT_KEY);
    barcodeInputRef.current?.focus();
  }

  async function finalize(values: BillFormSchema) {
    if (draftItems.length === 0) { push(t('billing.addOneProduct'), 'error'); return; }
    try {
      const bill = await createFinalizedBill({ items: draftItems, form: { ...values, paidAmount: actualPaidAmount } });
      clearDraft();
      setConfirmOpen(false);
      push(t('billing.billCreated', { billNumber: bill.billNumber }));
    } catch (error) {
      push(error instanceof Error ? error.message : t('billing.billFailed'), 'error');
    }
  }

  if (!products) {
    return <Card><p className="text-sm text-slate-500">{t('billing.loadingPos')}</p></Card>;
  }

  const canFinalize = draftItems.length > 0 && actualChangeAmount >= 0;

  return (
    <>
      {/* Two-column layout: items panel | summary panel */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-5 items-start">

        {/* ── Build bill panel ─────────────────────────────────────────── */}
        <Card className="flex flex-col gap-4">
          <h3 className="text-base font-semibold text-slate-800">{t('billing.buildBill')}</h3>

          {/* Barcode input row */}
          <div className="flex gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder={t('billing.typeBarcode')}
              value={barcodeQuery}
              onChange={(e) => setBarcodeQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addByBarcode(); } }}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={addByBarcode}>
              {t('common.add')}
            </Button>
            <Button type="button" onClick={() => setScannerOpen(true)}>
              {t('common.scan')}
            </Button>
          </div>

          {/* Product select row */}
          <div className="flex gap-2">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)} className="flex-1">
              <option value="">{t('billing.selectProduct')}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.quantityInStock} {t('billing.stock').toLowerCase()})
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={addBySelection}>
              {t('billing.addItem')}
            </Button>
          </div>

          {/* Items table */}
          {draftItems.length === 0 ? (
            <EmptyState title={t('billing.noItems')} description={t('billing.noItemsDesc')} />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {[t('billing.product'), t('billing.stock'), t('billing.qty'),
                      t('billing.sell'), t('billing.subtotalCol'), t('billing.profit'), ''].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draftItems.map((item) => (
                    <tr key={item.productId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-3 py-2.5 font-medium text-slate-800">{item.name}</td>
                      <td className="px-3 py-2.5 text-slate-500 tabular-nums">{item.availableStock}</td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number" min={1} max={item.availableStock}
                          value={item.quantity}
                          onChange={(e) => updateQuantity(item.productId, Number(e.target.value))}
                          className="w-20 text-center"
                        />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-slate-700">
                        {formatCurrency(item.unitSellPrice, currency)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-medium text-slate-800">
                        {formatCurrency(item.unitSellPrice * item.quantity, currency)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-green-600 font-medium">
                        {formatCurrency((item.unitSellPrice - item.unitBuyPrice) * item.quantity, currency)}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button
                          type="button" variant="ghost" size="sm"
                          onClick={() => setDraftItems((cur) => cur.filter((i) => i.productId !== item.productId))}
                        >
                          {t('common.remove')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* ── Bill summary panel ───────────────────────────────────────── */}
        <div className="xl:sticky xl:top-6">
          <Card className="flex flex-col gap-4">
            <h3 className="text-base font-semibold text-slate-800">{t('billing.billSummary')}</h3>

            <form
              className="flex flex-col gap-3"
              onSubmit={form.handleSubmit(() => setConfirmOpen(true))}
            >
              <FormField label={t('billing.cashierName')}>
                <Input {...form.register('cashierName')} />
              </FormField>
              <FormField label={t('billing.customerName')}>
                <Input {...form.register('customerName')} />
              </FormField>
              <FormField label={t('billing.customerPhone')}>
                <Input {...form.register('customerPhone')} />
              </FormField>
              <FormField label={t('billing.paymentMethod')}>
                <Select {...form.register('paymentMethod')}>
                  <option value="cash">{t('common.cash')}</option>
                  <option value="card">{t('common.card')}</option>
                  <option value="mixed">{t('common.mixed')}</option>
                  <option value="credit">{t('common.credit')}</option>
                </Select>
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label={t('billing.discount')}>
                  <Input type="number" step="0.01" {...form.register('discountAmount', { valueAsNumber: true })} />
                </FormField>
                <FormField label={t('billing.tax')}>
                  <Input type="number" step="0.01" {...form.register('taxAmount', { valueAsNumber: true })} />
                </FormField>
              </div>

              <FormField label={t('billing.expectedPaid')}>
                <Input type="number" step="0.01" value={expectedPaidAmount} readOnly />
              </FormField>

              <FormField label={t('billing.actualPaid')}>
                <div className="flex gap-2">
                  <Input
                    type="number" step="0.01"
                    value={Number.isFinite(actualPaidAmount) ? actualPaidAmount : 0}
                    onChange={(e) => {
                      setIsPaidAmountManuallyEdited(true);
                      const v = e.target.value === '' ? 0 : Number(e.target.value);
                      form.setValue('paidAmount', Number.isFinite(v) ? v : 0, { shouldDirty: true, shouldValidate: true });
                    }}
                    className="flex-1"
                  />
                  {isPaidAmountManuallyEdited && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setIsPaidAmountManuallyEdited(false)}>
                      {t('common.reset')}
                    </Button>
                  )}
                </div>
              </FormField>

              <FormField label={t('billing.notes')}>
                <Input {...form.register('notes')} />
              </FormField>

              {/* Totals card */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
                <SummaryRow label={t('billing.subtotal')} value={formatCurrency(billSummary.subtotal, currency)} />
                <SummaryRow label={t('billing.total')} value={formatCurrency(billSummary.totalAmount, currency)} highlight />
                <SummaryRow label={t('billing.totalProfit')} value={formatCurrency(billSummary.totalProfit, currency)} />
                <SummaryRow label={t('billing.change')} value={formatCurrency(actualChangeAmount, currency)} highlight />
              </div>

              {!canFinalize && draftItems.length > 0 && (
                <p className="text-xs text-red-600 font-medium">{t('billing.paidBelowTotal')}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={clearDraft} className="flex-1">
                  {t('billing.clearDraft')}
                </Button>
                <Button type="submit" disabled={!canFinalize} className="flex-1">
                  {t('billing.reviewFinalize')}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>

      {/* ── Confirm modal ────────────────────────────────────────────────── */}
      <Modal
        open={confirmOpen}
        title={t('billing.finalizeBill')}
        description={t('billing.finalizeDesc')}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={form.handleSubmit(finalize)}>
              {t('billing.confirmSave')}
            </Button>
          </>
        }
      >
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <SummaryRow label={t('billing.items')} value={String(draftItems.length)} />
          <SummaryRow label={t('billing.total')} value={formatCurrency(billSummary.totalAmount, currency)} highlight />
          <SummaryRow label={t('billing.paid')} value={formatCurrency(actualPaidAmount, currency)} />
          <SummaryRow label={t('billing.change')} value={formatCurrency(actualChangeAmount, currency)} highlight />
        </div>
      </Modal>

      {/* ── Barcode scanner modal ─────────────────────────────────────────── */}
      <BarcodeScannerModal
        open={scannerOpen}
        onClose={() => { setScannerOpen(false); setTimeout(() => barcodeInputRef.current?.focus(), 0); }}
        title={t('billing.scanProduct')}
        description={t('billing.scanProductDesc')}
        onDetected={handleScanForBill}
        continuous
      />
    </>
  );
}
