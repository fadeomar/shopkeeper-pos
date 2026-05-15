'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/components/providers/auth-context';
import { fetchUserDoc, updateUserStatus } from '@/lib/firebase/auth-service';
import {
  fetchUserBills,
  fetchUserBillItems,
  fetchUserCustomerPayments,
  fetchUserCustomers,
  fetchUserProducts,
  fetchUserSettings,
  fetchUserStockMovements,
  fetchUserSupportSnapshot,
  fetchUserSyncMeta,
  netBillTotal,
  updateUserSettingsInCloud,
  type SupportHealth,
  type UserSupportSnapshot,
} from '@/lib/firebase/admin-service';
import { downloadCSV } from '@/lib/utils/export-csv';
import type { AppUser, Bill, BillItem, Customer, CustomerPayment, Product, Settings, StockMovement } from '@/types/domain';

const STATUS_COLORS = {
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-red-100 text-red-600',
  pending:  'bg-amber-100 text-amber-700',
};

const HEALTH_COLORS: Record<SupportHealth, string> = {
  healthy: 'bg-green-100 text-green-700',
  needs_attention: 'bg-amber-100 text-amber-700',
  no_backup: 'bg-red-100 text-red-600',
};

function userDisplayStatus(u: AppUser): 'active' | 'inactive' | 'pending' {
  if (u.pendingApproval) return 'pending';
  return u.isActive ? 'active' : 'inactive';
}

export default function UserDetailPage() {
  const { uid } = useParams<{ uid: string }>();
  const { isAdmin } = useAuth();

  const [profile, setProfile]     = useState<AppUser | null>(null);
  const [support, setSupport]     = useState<UserSupportSnapshot | null>(null);
  const [bills, setBills]         = useState<Bill[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [settings, setSettings]   = useState<Settings | null>(null);
  const [payments, setPayments]   = useState<CustomerPayment[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [toggling, setToggling]   = useState(false);

  useEffect(() => {
    if (!uid) return;
    void loadAll(uid);
  }, [uid]);

  async function loadAll(userId: string) {
    setLoading(true);
    setError('');
    try {
      const [prof, snapshot, b, p, s, cps, sms] = await Promise.all([
        fetchUserDoc(userId),
        fetchUserSupportSnapshot(userId),
        fetchUserBills(userId),
        fetchUserProducts(userId),
        fetchUserSettings(userId),
        fetchUserCustomerPayments(userId).catch(() => [] as CustomerPayment[]),
        fetchUserStockMovements(userId, 100).catch(() => [] as StockMovement[]),
      ]);
      setProfile(prof);
      setSupport(snapshot);
      setBills(b);
      setProducts(p);
      setSettings(s);
      setPayments(cps);
      setMovements(sms);
    } catch {
      setError('Could not load user data. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  async function toggleStatus() {
    if (!profile) return;
    setToggling(true);
    try {
      const next = !profile.isActive;
      await updateUserStatus(profile.uid, next);
      setProfile({ ...profile, isActive: next, pendingApproval: false });
    } catch {
      setError('Failed to update status.');
    } finally {
      setToggling(false);
    }
  }

  const salesByMethod = useMemo(() => {
    if (!support) return [];
    return [
      ['Cash', support.cashSales],
      ['Card', support.cardSales],
      ['Credit', support.creditSales],
    ] as const;
  }, [support]);

  async function exportBackupJSON() {
    if (!profile) return;
    // Bills without bill items aren't enough to reconstruct receipts or
    // product-level sales; customers without their table aren't enough to
    // resolve customerId references on bills. Fetch both alongside the
    // existing collections so the support backup is actually portable.
    const [
      allBills,
      allBillItems,
      allProducts,
      allMovements,
      allPayments,
      allCustomers,
      currentSettings,
      syncMeta,
    ] = await Promise.all([
      fetchUserBills(profile.uid, 5000),
      fetchUserBillItems(profile.uid).catch(() => [] as BillItem[]),
      fetchUserProducts(profile.uid),
      fetchUserStockMovements(profile.uid, 5000).catch(() => [] as StockMovement[]),
      fetchUserCustomerPayments(profile.uid).catch(() => [] as CustomerPayment[]),
      fetchUserCustomers(profile.uid).catch(() => [] as Customer[]),
      fetchUserSettings(profile.uid),
      fetchUserSyncMeta(profile.uid),
    ]);
    const payload = {
      uid: profile.uid,
      email: profile.email,
      name: profile.name,
      exportedAt: new Date().toISOString(),
      syncMeta,
      settings: currentSettings,
      counts: {
        bills: allBills.length,
        billItems: allBillItems.length,
        products: allProducts.length,
        stockMovements: allMovements.length,
        customerPayments: allPayments.length,
        customers: allCustomers.length,
      },
      bills: allBills,
      billItems: allBillItems,
      products: allProducts,
      stockMovements: allMovements,
      customerPayments: allPayments,
      customers: allCustomers,
    };
    downloadJSON(payload, `support_backup_${profile.name || profile.uid}_${today()}.json`);
  }

  function exportBillsCSV() {
    downloadCSV(bills, [
      { header: 'Bill #',         value: (b) => b.billNumber },
      { header: 'Date',           value: (b) => b.createdAt.slice(0, 10) },
      { header: 'Customer',       value: (b) => b.customerName ?? '' },
      { header: 'Customer Phone', value: (b) => b.customerPhone ?? '' },
      { header: 'Cashier',        value: (b) => b.cashierName ?? '' },
      { header: 'Payment',        value: (b) => b.paymentMethod },
      { header: 'Subtotal',       value: (b) => b.subtotal },
      { header: 'Discount',       value: (b) => b.discountAmount },
      { header: 'Tax',            value: (b) => b.taxAmount },
      { header: 'Net Total',      value: (b) => netBillTotal(b) },
      { header: 'Paid',           value: (b) => b.paidAmount },
      { header: 'Change',         value: (b) => b.changeAmount },
      { header: 'Items',          value: (b) => b.itemCount },
      { header: 'Status',         value: (b) => b.status },
    ], `bills_${profile?.name ?? uid}_${today()}.csv`);
  }

  function exportProductsCSV() {
    downloadCSV(products, [
      { header: 'Barcode',       value: (p) => p.barcode },
      { header: 'Name',          value: (p) => p.name },
      { header: 'Category',      value: (p) => p.category },
      { header: 'Brand',         value: (p) => p.brand ?? '' },
      { header: 'Unit',          value: (p) => p.unit },
      { header: 'Stock',         value: (p) => p.quantityInStock },
      { header: 'Min Stock Alert', value: (p) => p.minimumStockAlert },
      { header: 'Buy Price',     value: (p) => p.buyPrice },
      { header: 'Sell Price',    value: (p) => p.sellPrice },
      { header: 'Supplier',      value: (p) => p.supplierName ?? '' },
      { header: 'Shelf',         value: (p) => p.shelfLocation ?? '' },
      { header: 'Expiry',        value: (p) => p.expiryDate ?? '' },
      { header: 'Status',        value: (p) => p.status },
    ], `products_${profile?.name ?? uid}_${today()}.csv`);
  }

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 bg-white border border-red-100 rounded-2xl text-center">
        <p className="font-semibold text-red-600">Access Denied</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <BackLink />
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
          Loading user support data…
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <BackLink />
        <div className="bg-white border border-red-100 rounded-2xl p-6 text-center">
          <p className="text-red-600 font-medium">User not found</p>
          {error && <p className="text-sm text-slate-500 mt-1">{error}</p>}
        </div>
      </div>
    );
  }

  const displayStatus = userDisplayStatus(profile);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start gap-3">
        <BackLink />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h1 className="text-lg font-bold text-slate-800">{profile.name}</h1>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[displayStatus]}`}>
                {displayStatus}
              </span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {profile.role}
              </span>
              {support && <HealthBadge health={support.syncHealth} />}
            </div>
            <div className="space-y-1 text-sm text-slate-500">
              <p><a href={`mailto:${profile.email}`} className="hover:text-blue-600 transition-colors">{profile.email}</a></p>
              {profile.phone && <p><a href={`tel:${profile.phone}`} className="hover:text-blue-600 transition-colors">{profile.phone}</a></p>}
              <p className="text-xs text-slate-400">Joined {profile.createdAt.slice(0, 10)}</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => void loadAll(profile.uid)}
              className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => void exportBackupJSON()}
              className="px-4 py-2 text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-xl transition-colors"
            >
              Export backup JSON
            </button>
            {displayStatus === 'pending' && (
              <button
                onClick={toggleStatus}
                disabled={toggling}
                className="px-4 py-2 text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 rounded-xl transition-colors disabled:opacity-60"
              >
                Approve
              </button>
            )}
            {displayStatus !== 'pending' && (
              <button
                onClick={toggleStatus}
                disabled={toggling}
                className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors disabled:opacity-60 ${
                  profile.isActive
                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                }`}
              >
                {toggling ? '…' : profile.isActive ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
          </div>
        </div>
      </div>

      {support && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Backup Health" value={healthLabel(support.syncHealth)} tone={support.syncHealth === 'healthy' ? 'green' : 'red'} />
            <StatCard label="Last Cloud Sync" value={support.lastSyncAt ? relativeTime(support.lastSyncAt) : 'No backup'} tone={support.lastSyncAt ? undefined : 'red'} />
            <StatCard label="Cloud Bills" value={support.billCount} />
            <StatCard label="Cloud Products" value={support.productCount} />
            <StatCard label="Net Sales" value={support.totalRevenue.toFixed(2)} />
            <StatCard label="Customer Debt" value={support.creditDebt.toFixed(2)} tone={support.creditDebt > 0 ? 'amber' : undefined} />
            <StatCard label="Low Stock" value={support.lowStockCount} tone={support.lowStockCount > 0 ? 'amber' : undefined} />
            <StatCard label="Out of Stock" value={support.outOfStockCount} tone={support.outOfStockCount > 0 ? 'red' : undefined} />
          </div>

          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Support Checklist</h2>
              {support.warnings.length === 0 ? (
                <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                  No support warnings found. Backup looks healthy.
                </p>
              ) : (
                <ul className="space-y-2">
                  {support.warnings.map((warning) => (
                    <li key={warning} className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                      {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Backup Counts</h2>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <ReadRow label="Bill items" value={String(support.syncMeta?.recordCounts?.billItems ?? '—')} />
                <ReadRow label="Stock movements" value={String(support.stockMovementCount)} />
                <ReadRow label="Customer payments" value={String(support.customerPaymentCount)} />
                <ReadRow label="Settings updated" value={support.settingsUpdatedAt ? relativeTime(support.settingsUpdatedAt) : 'No settings'} />
                <ReadRow label="Active products" value={String(support.activeProductCount)} />
                <ReadRow label="Inactive products" value={String(support.inactiveProductCount)} />
                <ReadRow label="Voided bills" value={String(support.voidedBillCount)} />
                <ReadRow label="Returned bills" value={String(support.returnedBillCount)} />
              </div>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Payment Snapshot</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {salesByMethod.map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 px-4 py-3">
                  <p className="text-xs text-slate-500 mb-1">{label}</p>
                  <p className="text-lg font-bold text-slate-800 tabular-nums">{value.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {support && support.billCount === 0 && support.productCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No seller data has synced yet. Ask the user to open the app online and run sync once.
        </div>
      )}

      {bills.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Recent Bills <span className="text-slate-400 font-normal">({bills.length})</span>
            </h2>
            <button onClick={exportBillsCSV} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Export CSV
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <Th>Bill #</Th>
                    <Th>Date</Th>
                    <Th>Customer</Th>
                    <Th>Payment</Th>
                    <Th right>Net Total</Th>
                    <Th right>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {bills.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{b.billNumber}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{b.createdAt.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-slate-700 max-w-[140px] truncate">
                        {b.customerName || <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-500 capitalize">{b.paymentMethod}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800 tabular-nums">{netBillTotal(b).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right"><BillStatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      <SettingsCard uid={uid} settings={settings} onSaved={setSettings} />

      {payments.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Recent Customer Payments</h2>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100"><Th>Date</Th><Th>Customer</Th><Th>Note</Th><Th right>Amount</Th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {payments.slice(0, 20).map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{p.createdAt.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-slate-700">{p.customerName}</td>
                      <td className="px-4 py-3 text-slate-500">{p.note || '—'}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800 tabular-nums">{p.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {products.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Products <span className="text-slate-400 font-normal">({products.length})</span>
            </h2>
            <button onClick={exportProductsCSV} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">
              Export CSV
            </button>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <Th>Name</Th>
                    <Th>Category</Th>
                    <Th>Barcode</Th>
                    <Th right>Stock</Th>
                    <Th right>Sell Price</Th>
                    <Th right>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {products.slice(0, 100).map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">{p.name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.category}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.barcode}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${p.quantityInStock <= 0 ? 'text-red-600 font-semibold' : 'text-slate-700'}`}>{p.quantityInStock}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-800">{p.sellPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {products.length > 100 && <p className="text-xs text-slate-400 mt-2">Showing first 100 products. Use export for the full list.</p>}
        </section>
      )}

      {movements.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Recent Stock Movements</h2>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100"><Th>Date</Th><Th>Type</Th><Th>Reference</Th><Th>Note</Th><Th right>Qty</Th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {movements.slice(0, 30).map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{m.createdAt.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-slate-700 capitalize">{m.movementType}</td>
                      <td className="px-4 py-3 text-slate-500">{m.referenceType}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-[240px] truncate">{m.note || '—'}</td>
                      <td className={`px-4 py-3 text-right font-medium tabular-nums ${m.quantityChange < 0 ? 'text-red-600' : 'text-green-700'}`}>{m.quantityChange}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href={'/admin/users' as Route} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
      Back to Support Dashboard
    </Link>
  );
}

function HealthBadge({ health }: { health: SupportHealth }) {
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${HEALTH_COLORS[health]}`}>{healthLabel(health)}</span>;
}

function healthLabel(health: SupportHealth) {
  if (health === 'healthy') return 'Healthy backup';
  if (health === 'needs_attention') return 'Needs attention';
  return 'No backup';
}

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'green' | 'amber' | 'red' }) {
  const toneClass = tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-600' : tone === 'red' ? 'text-red-600' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-4 py-3 text-xs font-medium text-slate-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>;
}

function BillStatusBadge({ status }: { status: Bill['status'] }) {
  const cls = status === 'finalized'
    ? 'bg-green-100 text-green-700'
    : status === 'voided'
      ? 'bg-red-100 text-red-600'
      : 'bg-amber-100 text-amber-700';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{status}</span>;
}

function ReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

interface SettingsCardProps {
  uid: string;
  settings: Settings | null;
  onSaved: (s: Settings) => void;
}

function SettingsCard({ uid, settings, onSaved }: SettingsCardProps) {
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState('');

  const [storeName,         setStoreName]         = useState('');
  const [cashierName,       setCashierName]        = useState('');
  const [currency,          setCurrency]           = useState('');
  const [allowLossSale,     setAllowLossSale]      = useState(false);
  const [lowStockHighlight, setLowStockHighlight]  = useState(true);

  function startEdit() {
    if (!settings) return;
    setStoreName(settings.storeName);
    setCashierName(settings.cashierName ?? '');
    setCurrency(settings.currency);
    setAllowLossSale(settings.allowLossSale);
    setLowStockHighlight(settings.lowStockHighlight);
    setSaveError('');
    setEditing(true);
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setSaveError('');
    try {
      const updated: Settings = {
        ...settings,
        storeName:         storeName.trim() || settings.storeName,
        cashierName:       cashierName.trim() || undefined,
        currency:          currency.trim() || settings.currency,
        allowLossSale,
        lowStockHighlight,
        updatedAt:         new Date().toISOString(),
      };
      await updateUserSettingsInCloud(uid, updated);
      onSaved(updated);
      setEditing(false);
    } catch {
      setSaveError('Failed to save. Check your connection.');
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">Settings</h2>
        <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm text-slate-400">
          No settings synced yet — appears after the user saves settings at least once.
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-700">Settings</h2>
        {!editing && <button onClick={startEdit} className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors">Edit</button>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        {editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SettingsField label="Store Name"><input value={storeName} onChange={(e) => setStoreName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></SettingsField>
              <SettingsField label="Cashier Name"><input value={cashierName} onChange={(e) => setCashierName(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="optional" /></SettingsField>
              <SettingsField label="Currency"><input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></SettingsField>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={allowLossSale} onChange={(e) => setAllowLossSale(e.target.checked)} />Allow selling below cost price</label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700"><input type="checkbox" className="w-4 h-4 accent-blue-600" checked={lowStockHighlight} onChange={(e) => setLowStockHighlight(e.target.checked)} />Highlight low-stock products</label>
            </div>

            {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(false)} disabled={saving} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-xl transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <ReadRow label="Store Name" value={settings.storeName} />
            <ReadRow label="Cashier Name" value={settings.cashierName ?? '—'} />
            <ReadRow label="Currency" value={settings.currency} />
            <ReadRow label="Allow Loss Sale" value={settings.allowLossSale ? 'Yes' : 'No'} />
            <ReadRow label="Low Stock Highlight" value={settings.lowStockHighlight ? 'On' : 'Off'} />
            <ReadRow label="Last Updated" value={new Date(settings.updatedAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} />
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>{children}</label>;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 'Unknown';
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function downloadJSON(value: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-z0-9._-]+/gi, '_');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
