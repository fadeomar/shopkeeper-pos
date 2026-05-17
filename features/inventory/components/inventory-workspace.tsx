'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { settingsRepo } from '@/lib/db/repositories';
import { countProductStock } from '@/lib/services/inventory-service';
import { formatCurrency } from '@/lib/utils/money';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/ui/data-table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import type { Product, StockMovement } from '@/types/domain';
import type { ColumnDef } from '@tanstack/react-table';

type InventoryModalMode = 'count' | null;

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
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // buyPrice + supplierName were used by the legacy "Receive stock" modal.
  // Stock receiving is now done through /purchases/new where supplier and
  // multi-line cost tracking are first-class. These two pieces of local
  // state are kept as stubs only to avoid widening the diff on every other
  // bit of state in this file.
  const buyPrice = '';
  const supplierName = '';
  void buyPrice;
  void supplierName;

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
    setNote('');
  }

  function closeModal() {
    if (submitting) return;
    setMode(null);
  }

  async function submitInventoryAction() {
    const product = activeProducts.find((item) => item.id === selectedProductId);
    const parsedQuantity = Number(quantity);

    if (!product) {
      push(t('inventory.selectProductFirst'));
      return;
    }
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 0) {
      push(t('inventory.invalidQuantity'));
      return;
    }

    try {
      setSubmitting(true);
      if (mode === 'count') {
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

  const movementColumns: ColumnDef<StockMovement>[] = [
    {
      header: t('inventory.date'),
      accessorKey: 'createdAt',
      cell: ({ row }) => <span className="whitespace-nowrap text-slate-500">{formatDateTime(row.original.createdAt)}</span>,
    },
    {
      header: t('inventory.product'),
      accessorKey: 'productId',
      cell: ({ row }) => <span className="font-medium text-slate-800">{productsById.get(row.original.productId)?.name ?? t('inventory.unknownProduct')}</span>,
    },
    {
      header: t('inventory.type'),
      accessorKey: 'movementType',
      cell: ({ row }) => <span className="capitalize text-slate-600">{row.original.movementType}</span>,
    },
    {
      header: t('inventory.change'),
      accessorKey: 'quantityChange',
      cell: ({ row }) => {
        const isPositive = row.original.quantityChange >= 0;
        return (
          <span className={`whitespace-nowrap font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
            {isPositive ? '+' : ''}{row.original.quantityChange}
          </span>
        );
      },
    },
    {
      header: t('inventory.note'),
      accessorKey: 'note',
      cell: ({ row }) => <span className="min-w-[220px] text-slate-500">{row.original.note || row.original.referenceType}</span>,
    },
  ];

  const productOptions = activeProducts.map((product) => ({
    value: product.id,
    label: product.name,
    description: [product.barcode, product.shelfLocation ? `${t('products.shelf')} ${product.shelfLocation}` : null]
      .filter(Boolean)
      .join(' • '),
    meta: <span className="text-xs text-slate-500">{t('inventory.currentStock')}: {product.quantityInStock}</span>,
  }));

  return (
    <PageShell>
      <PageHeader
        title={t('inventory.title')}
        description={t('inventory.subtitle')}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => openModal('count')}>
              {t('inventory.stockCount')}
            </Button>
            <Link
              href={"/purchases/new" as never}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
            >
              {t('purchases.newPurchase')}
            </Link>
          </>
        }
      />

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
          actionLabel={t('purchases.newPurchase')}
          onAction={() => {
            window.location.href = '/purchases/new';
          }}
        />
        <InventoryListCard
          title={t('inventory.outOfStock')}
          emptyText={t('inventory.noOutOfStock')}
          products={outOfStockProducts}
          actionLabel={t('purchases.newPurchase')}
          onAction={() => {
            window.location.href = '/purchases/new';
          }}
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

      <DataTable
        columns={movementColumns}
        data={movements ?? []}
        title={t('inventory.movementHistory')}
        description={t('inventory.movementHistoryDesc')}
        loading={!movements}
        emptyTitle={t('inventory.noMovements')}
        searchPlaceholder={t('dataTable.search')}
        labels={{
          searchPlaceholder: t('dataTable.search'),
          loading: t('dataTable.loading'),
          page: t('dataTable.page'),
          of: t('dataTable.of'),
          rowsPerPage: t('dataTable.rowsPerPage'),
          first: t('dataTable.first'),
          previous: t('dataTable.previous'),
          next: t('dataTable.next'),
          last: t('dataTable.last'),
        }}
        pageSize={10}
        getRowId={(row) => row.id}
        />

      <Modal
        open={mode !== null}
        title={t('inventory.stockCount')}
        description={t('inventory.stockCountDesc')}
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
            <SearchableSelect
              value={selectedProductId}
              onValueChange={(value) => setSelectedProductId(value ?? '')}
              options={productOptions}
              placeholder={t('inventory.product')}
              searchPlaceholder={t('products.searchPlaceholder')}
              emptyMessage={t('products.noProducts')}
              disabled={!activeProducts.length}
            />
          </label>

          {selectedProduct && (
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {t('inventory.currentStock')}: <strong>{selectedProduct.quantityInStock}</strong>
              {Number.isFinite(countedDifference) && quantity.trim() && (
                <span className="ms-3">
                  {t('inventory.difference')}: <strong>{countedDifference > 0 ? '+' : ''}{countedDifference}</strong>
                </span>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t('inventory.countedQuantity')}
            <Input
              type="number"
              min={0}
              step={1}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t('inventory.note')}
            <Input value={note} placeholder={t('inventory.notePlaceholder')} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </Modal>
    </PageShell>
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
