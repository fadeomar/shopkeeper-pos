'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { countProductStock, receiveProductStock } from '@/lib/services/inventory-service';
import { formatCurrency } from '@/lib/utils/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import type { Product, StockMovement } from '@/types/domain';

type InventoryModalMode = 'receive' | 'count' | null;

const EXPIRY_WINDOW_DAYS = 30;

function daysUntil(date: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function productLabel(product: Product): string {
  return `${product.name} (${product.barcode})`;
}

export function InventoryWorkspace() {
  const { t } = useLocale();
  const { push } = useToast();
  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
  const movements = useLiveQuery(
    () => db.stockMovements.orderBy('createdAt').reverse().limit(75).toArray(),
    [],
  );
  const settings = useLiveQuery(() => settingsRepo.get(), []);

  const [mode, setMode] = useState<InventoryModalMode>(null);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyPrice, setBuyPrice] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const activeProducts = useMemo(
    () => (products ?? []).filter((product) => product.status === 'active'),
    [products],
  );

  const productsById = useMemo(() => {
    const map = new Map<string, Product>();
    (products ?? []).forEach((product) => map.set(product.id, product));
    return map;
  }, [products]);

  const lowStockProducts = activeProducts.filter(
    (product) => product.quantityInStock > 0 && product.quantityInStock <= product.minimumStockAlert,
  );
  const outOfStockProducts = activeProducts.filter((product) => product.quantityInStock <= 0);
  const expiringProducts = activeProducts
    .filter((product) => {
      if (!product.expiryDate) return false;
      const days = daysUntil(product.expiryDate);
      return days >= 0 && days <= EXPIRY_WINDOW_DAYS;
    })
    .sort((a, b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));

  const currency = settings?.currency ?? 'USD';
  const stockValue = activeProducts.reduce(
    (sum, product) => sum + product.quantityInStock * product.buyPrice,
    0,
  );
  const retailValue = activeProducts.reduce(
    (sum, product) => sum + product.quantityInStock * product.sellPrice,
    0,
  );

  function openModal(nextMode: Exclude<InventoryModalMode, null>, product?: Product) {
    setMode(nextMode);
    setSelectedProductId(product?.id ?? activeProducts[0]?.id ?? '');
    setQuantity(nextMode === 'count' && product ? String(product.quantityInStock) : '');
    setBuyPrice(product?.buyPrice != null ? String(product.buyPrice) : '');
    setSupplierName(product?.supplierName ?? '');
    setNote('');
  }

  function closeModal() {
    if (submitting) return;
    setMode(null);
  }

  async function submitInventoryAction() {
    const product = activeProducts.find((item) => item.id === selectedProductId);
    const parsedQuantity = Number(quantity);
    const parsedBuyPrice = buyPrice.trim() ? Number(buyPrice) : undefined;

    if (!product) {
      push(t('inventory.selectProductFirst'));
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
      push(t('inventory.invalidQuantity'));
      return;
    }
    if (mode === 'receive' && parsedQuantity <= 0) {
      push(t('inventory.invalidReceiveQuantity'));
      return;
    }
    if (parsedBuyPrice !== undefined && (!Number.isFinite(parsedBuyPrice) || parsedBuyPrice < 0)) {
      push(t('inventory.invalidBuyPrice'));
      return;
    }

    try {
      setSubmitting(true);
      if (mode === 'receive') {
        await receiveProductStock(product, parsedQuantity, note, parsedBuyPrice, supplierName);
        push(t('inventory.stockReceived'));
      } else if (mode === 'count') {
        await countProductStock(product, parsedQuantity, note);
        push(t('inventory.stockCountSaved'));
      }
      setMode(null);
    } catch (error) {
      push(error instanceof Error ? error.message : t('inventory.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  const selectedProduct = activeProducts.find((product) => product.id === selectedProductId);
  const countedDifference = selectedProduct && mode === 'count' && quantity.trim()
    ? Number(quantity) - selectedProduct.quantityInStock
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{t('inventory.title')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">{t('inventory.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => openModal('count')}>
            {t('inventory.stockCount')}
          </Button>
          <Button type="button" onClick={() => openModal('receive')}>
            {t('inventory.receiveStock')}
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('inventory.lowStock')} value={lowStockProducts.length} />
        <StatCard label={t('inventory.outOfStock')} value={outOfStockProducts.length} />
        <StatCard label={t('inventory.expiringSoon')} value={expiringProducts.length} />
        <StatCard label={t('inventory.stockCostValue')} value={formatCurrency(stockValue, currency)} helper={formatCurrency(retailValue, currency)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <InventoryListCard
          title={t('inventory.lowStock')}
          emptyText={t('inventory.noLowStock')}
          products={lowStockProducts}
          actionLabel={t('inventory.receive')}
          onAction={(product) => openModal('receive', product)}
        />
        <InventoryListCard
          title={t('inventory.outOfStock')}
          emptyText={t('inventory.noOutOfStock')}
          products={outOfStockProducts}
          actionLabel={t('inventory.receive')}
          onAction={(product) => openModal('receive', product)}
        />
        <InventoryListCard
          title={t('inventory.expiringSoon')}
          emptyText={t('inventory.noExpiringSoon')}
          products={expiringProducts}
          actionLabel={t('inventory.count')}
          onAction={(product) => openModal('count', product)}
          renderMeta={(product) => `${t('inventory.expires')}: ${product.expiryDate}`}
        />
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{t('inventory.movementHistory')}</h3>
            <p className="text-sm text-slate-500">{t('inventory.movementHistoryDesc')}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead>
              <tr className="text-start text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 text-start">{t('inventory.date')}</th>
                <th className="px-3 py-2 text-start">{t('inventory.product')}</th>
                <th className="px-3 py-2 text-start">{t('inventory.type')}</th>
                <th className="px-3 py-2 text-end">{t('inventory.change')}</th>
                <th className="px-3 py-2 text-start">{t('inventory.note')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(movements ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    {t('inventory.noMovements')}
                  </td>
                </tr>
              )}
              {(movements ?? []).map((movement) => (
                <MovementRow
                  key={movement.id}
                  movement={movement}
                  product={productsById.get(movement.productId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={mode !== null}
        title={mode === 'receive' ? t('inventory.receiveStock') : t('inventory.stockCount')}
        description={mode === 'receive' ? t('inventory.receiveStockDesc') : t('inventory.stockCountDesc')}
        onClose={closeModal}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={closeModal} disabled={submitting}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={submitInventoryAction} disabled={submitting || !activeProducts.length}>
              {submitting ? t('common.loading') : t('common.save')}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t('inventory.product')}
            <Select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
              {activeProducts.map((product) => (
                <option key={product.id} value={product.id}>{productLabel(product)}</option>
              ))}
            </Select>
          </label>

          {selectedProduct && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {t('inventory.currentStock')}: <strong>{selectedProduct.quantityInStock}</strong>
              {mode === 'count' && Number.isFinite(countedDifference) && quantity.trim() && (
                <span className="ms-3">
                  {t('inventory.difference')}: <strong>{countedDifference > 0 ? '+' : ''}{countedDifference}</strong>
                </span>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {mode === 'receive' ? t('inventory.quantityReceived') : t('inventory.countedQuantity')}
            <Input
              type="number"
              min={mode === 'receive' ? 1 : 0}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>

          {mode === 'receive' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                {t('inventory.newBuyPrice')}
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={buyPrice}
                  onChange={(event) => setBuyPrice(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                {t('inventory.supplier')}
                <Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
              </label>
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t('inventory.note')}
            <Input value={note} placeholder={t('inventory.notePlaceholder')} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function StatCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return (
    <Card className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {helper && <p className="text-xs text-slate-400">{helper}</p>}
    </Card>
  );
}

function InventoryListCard({
  title,
  emptyText,
  products,
  actionLabel,
  onAction,
  renderMeta,
}: {
  title: string;
  emptyText: string;
  products: Product[];
  actionLabel: string;
  onAction: (product: Product) => void;
  renderMeta?: (product: Product) => string;
}) {
  return (
    <Card className="flex min-h-[260px] flex-col gap-3">
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {products.length === 0 && <p className="py-6 text-sm text-slate-400">{emptyText}</p>}
      <div className="flex flex-col divide-y divide-slate-100">
        {products.slice(0, 8).map((product) => (
          <div key={product.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-800">{product.name}</p>
              <p className="text-xs text-slate-500">
                {renderMeta ? renderMeta(product) : `${product.quantityInStock} / min ${product.minimumStockAlert}`}
              </p>
            </div>
            <Button type="button" size="sm" variant="secondary" onClick={() => onAction(product)}>
              {actionLabel}
            </Button>
          </div>
        ))}
      </div>
      {products.length > 8 && <p className="text-xs text-slate-400">+{products.length - 8} more</p>}
    </Card>
  );
}

function MovementRow({ movement, product }: { movement: StockMovement; product?: Product }) {
  const { t } = useLocale();
  const isPositive = movement.quantityChange >= 0;

  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-3 text-slate-500">{formatDateTime(movement.createdAt)}</td>
      <td className="px-3 py-3 font-medium text-slate-800">{product?.name ?? t('inventory.unknownProduct')}</td>
      <td className="px-3 py-3 capitalize text-slate-600">{movement.movementType}</td>
      <td className={`whitespace-nowrap px-3 py-3 text-end font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
        {isPositive ? '+' : ''}{movement.quantityChange}
      </td>
      <td className="min-w-[220px] px-3 py-3 text-slate-500">{movement.note || movement.referenceType}</td>
    </tr>
  );
}
