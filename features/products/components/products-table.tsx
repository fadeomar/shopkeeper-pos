'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/schema';
import { formatCurrency } from '@/lib/utils/money';
import { formatDate } from '@/lib/utils/date';
import { adjustProductStock } from '@/lib/services/inventory-service';
import { productRepo, settingsRepo } from '@/lib/db/repositories';
import { enqueueSyncJob } from '@/lib/services/sync-queue-service';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/ui/modal';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useLocale } from '@/components/providers/locale-context';
import type { Product } from '@/types/domain';
import clsx from 'clsx';

export function ProductsTable({ onEdit }: { onEdit?: (product: Product) => void }) {
  const { t } = useLocale();
  const products  = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
  const settings  = useLiveQuery(() => settingsRepo.get(), []);
  const { push }  = useToast();
  const currency  = settings?.currency ?? 'USD';

  const [query,         setQuery]         = useState('');
  const [category,      setCategory]      = useState('all');
  const [adjustProduct, setAdjustProduct] = useState<Product | null>(null);
  const [adjustQty,     setAdjustQty]     = useState('1');
  const [adjustNote,    setAdjustNote]    = useState('Manual stock adjustment');

  const categories = useMemo(() => {
    const set = new Set((products ?? []).map((p) => p.category));
    return ['all', ...Array.from(set)];
  }, [products]);

  const filtered = useMemo(() => {
    return (products ?? []).filter((p) => {
      const matchQ = [p.name, p.barcode, p.brand, p.supplierName]
        .filter(Boolean).join(' ').toLowerCase().includes(query.toLowerCase());
      const matchC = category === 'all' || p.category === category;
      return matchQ && matchC;
    });
  }, [products, query, category]);

  async function toggleStatus(product: Product) {
    const newStatus = product.status === 'active' ? 'inactive' : 'active';
    await productRepo.update(product.id, {
      status: newStatus,
      lastUpdated: new Date().toISOString(),
      syncStatus: 'pending',
    });
    void enqueueSyncJob({ entity: 'product', entityId: product.id, operation: 'update' });
    push(product.status === 'active' ? t('products.productDeactivated') : t('products.productActivated'));
  }

  async function submitAdjustment() {
    if (!adjustProduct) return;
    const qty = Number(adjustQty);
    if (Number.isNaN(qty) || qty === 0) { push(t('products.nonZeroAdj'), 'error'); return; }
    try {
      await adjustProductStock(adjustProduct, qty, adjustNote || 'Manual stock adjustment');
      await db.products.update(adjustProduct.id, { syncStatus: 'pending' });
      void enqueueSyncJob({ entity: 'product', entityId: adjustProduct.id, operation: 'update' });
      push(t('products.stockAdjusted'));
      setAdjustProduct(null); setAdjustQty('1'); setAdjustNote('Manual stock adjustment');
    } catch (error) {
      push(error instanceof Error ? error.message : t('products.adjustFailed'), 'error');
    }
  }

  if (!products) return <Card><p className="text-sm text-slate-500">{t('products.loadingProducts')}</p></Card>;
  if (products.length === 0) {
    return <EmptyState title={t('products.noProducts')} description={t('products.noProductsDesc')} />;
  }

  const headers = [
    t('products.barcode'), t('products.name'), t('products.category'),
    t('products.qty'), t('products.buy'), t('products.sell'),
    t('products.min'), t('products.supplier'), t('products.dateAdded'),
    t('products.status'), t('products.actions'),
  ];

  return (
    <>
      <Card padding="sm">
        {/* Search & filter toolbar */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Input
            className="flex-1 min-w-[200px]"
            placeholder={t('products.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Select
            className="w-48"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c === 'all' ? t('products.allCategories') : c}</option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="border-b border-slate-200">
                {headers.map((h) => (
                  <th key={h} className="px-3 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((product) => {
                const lowStock = settings?.lowStockHighlight && product.quantityInStock <= product.minimumStockAlert;
                return (
                  <tr key={product.id} className={clsx('transition-colors', lowStock ? 'bg-amber-50' : 'hover:bg-slate-50/50')}>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{product.barcode}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-800">{product.name}</span>
                      {product.shelfLocation && (
                        <div className="text-xs text-slate-400">{t('products.shelf')} {product.shelfLocation}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{product.category}</td>
                    <td className={clsx('px-3 py-2.5 tabular-nums font-semibold', lowStock ? 'text-amber-700' : 'text-slate-700')}>
                      {product.quantityInStock}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-600">{formatCurrency(product.buyPrice, currency)}</td>
                    <td className="px-3 py-2.5 tabular-nums font-medium text-slate-800">{formatCurrency(product.sellPrice, currency)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-500">{product.minimumStockAlert}</td>
                    <td className="px-3 py-2.5 text-slate-600 max-w-[120px] truncate">{product.supplierName || '—'}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(product.dateAdded)}</td>
                    <td className="px-3 py-2.5">
                      <span className={clsx(
                        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                        product.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600',
                      )}>
                        {t(`common.${product.status}` as Parameters<typeof t>[0])}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => onEdit?.(product)}>
                          {t('common.edit')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setAdjustProduct(product); setAdjustQty('1'); }}>
                          {t('common.adjust')}
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => toggleStatus(product)}>
                          {product.status === 'active' ? t('common.deactivate') : t('common.activate')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Adjust stock modal */}
      <Modal
        open={Boolean(adjustProduct)}
        title={adjustProduct ? `${t('products.stockAdjustTitle')}: ${adjustProduct.name}` : t('products.stockAdjustTitle')}
        description={adjustProduct ? t('products.stockAdjustDesc', { count: adjustProduct.quantityInStock }) : undefined}
        onClose={() => setAdjustProduct(null)}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setAdjustProduct(null)}>
              {t('common.cancel')}
            </Button>
            <Button type="button" onClick={submitAdjustment}>
              {t('common.saveAdjustment')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t('products.quantityChange')}</span>
            <Input type="number" step="1" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">{t('products.reasonNote')}</span>
            <Input value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} />
          </label>
          {adjustProduct && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex flex-col gap-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('products.currentStock')}</span>
                <span className="font-semibold text-slate-800">{adjustProduct.quantityInStock}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">{t('products.resultingStock')}</span>
                <span className={clsx('font-bold', (adjustProduct.quantityInStock + (Number(adjustQty) || 0)) >= 0 ? 'text-green-700' : 'text-red-600')}>
                  {adjustProduct.quantityInStock + (Number(adjustQty) || 0)}
                </span>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
