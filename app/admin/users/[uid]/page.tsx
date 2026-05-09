'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/components/providers/auth-context';
import { fetchUserDoc, updateUserStatus } from '@/lib/firebase/auth-service';
import {
  fetchUserBills,
  fetchUserProducts,
  fetchUserSummary,
  fetchUserSettings,
  updateUserSettingsInCloud,
  type UserSummary,
} from '@/lib/firebase/admin-service';
import { downloadCSV } from '@/lib/utils/export-csv';
import type { AppUser, Bill, Product, Settings } from '@/types/domain';

const STATUS_COLORS = {
  active:   'bg-green-100 text-green-700',
  inactive: 'bg-red-100 text-red-600',
  pending:  'bg-amber-100 text-amber-700',
};

function userDisplayStatus(u: AppUser): 'active' | 'inactive' | 'pending' {
  if (u.pendingApproval) return 'pending';
  return u.isActive ? 'active' : 'inactive';
}

export default function UserDetailPage() {
  const { uid } = useParams<{ uid: string }>();
  const { isAdmin } = useAuth();

  const [profile, setProfile]     = useState<AppUser | null>(null);
  const [summary, setSummary]     = useState<UserSummary | null>(null);
  const [bills, setBills]         = useState<Bill[]>([]);
  const [products, setProducts]   = useState<Product[]>([]);
  const [settings, setSettings]   = useState<Settings | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [toggling, setToggling]   = useState(false);

  useEffect(() => {
    if (!uid) return;
    void loadAll(uid);
  }, [uid]);

  async function loadAll(userId: string) {
    try {
      const [prof, sum, b, p, s] = await Promise.all([
        fetchUserDoc(userId),
        fetchUserSummary(userId),
        fetchUserBills(userId),
        fetchUserProducts(userId),
        fetchUserSettings(userId),
      ]);
      setProfile(prof);
      setSummary(sum);
      setBills(b);
      setProducts(p);
      setSettings(s);
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
      { header: 'Total',          value: (b) => b.totalAmount },
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
      <div className="max-w-3xl mx-auto space-y-4">
        <BackLink />
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
          Loading user data…
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
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
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <BackLink />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{error}</p>
      )}

      {/* Profile card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-slate-800">{profile.name}</h1>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[displayStatus]}`}>
                {displayStatus}
              </span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {profile.role}
              </span>
            </div>
            <div className="space-y-1 text-sm text-slate-500">
              <p>
                <a href={`mailto:${profile.email}`} className="hover:text-blue-600 transition-colors">
                  {profile.email}
                </a>
              </p>
              {profile.phone && (
                <p>
                  <a href={`tel:${profile.phone}`} className="hover:text-blue-600 transition-colors">
                    {profile.phone}
                  </a>
                </p>
              )}
              <p className="text-xs text-slate-400">
                Joined {profile.createdAt.slice(0, 10)}
              </p>
            </div>
          </div>

          {/* Status toggle */}
          <div className="flex gap-2">
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

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Bills" value={summary.billCount} />
          <StatCard label="Total Revenue" value={`${summary.totalRevenue.toFixed(2)}`} />
          <StatCard label="Products" value={summary.productCount} />
        </div>
      )}

      {/* No data yet message */}
      {summary && summary.billCount === 0 && summary.productCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 text-sm text-amber-700">
          No data synced yet. Data appears here once this user goes online and uses the app.
        </div>
      )}

      {/* Bills table */}
      {bills.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Bills <span className="text-slate-400 font-normal">({bills.length})</span>
            </h2>
            <button
              onClick={exportBillsCSV}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
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
                    <Th right>Total</Th>
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
                      <td className="px-4 py-3 text-right font-medium text-slate-800 tabular-nums">
                        {b.totalAmount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          b.status === 'finalized' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Settings */}
      <SettingsCard uid={uid} settings={settings} onSaved={setSettings} />

      {/* Products table */}
      {products.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-700">
              Products <span className="text-slate-400 font-normal">({products.length})</span>
            </h2>
            <button
              onClick={exportProductsCSV}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
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
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[160px] truncate">{p.name}</td>
                      <td className="px-4 py-3 text-slate-500">{p.category}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.barcode}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{p.quantityInStock}</td>
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
        </section>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href={'/admin/users' as Route}
      className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to Users
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-xl font-bold text-slate-800 tabular-nums">{value}</p>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-3 text-xs font-medium text-slate-500 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

// ─── Settings card ────────────────────────────────────────────────────────────

interface SettingsCardProps {
  uid: string;
  settings: Settings | null;
  onSaved: (s: Settings) => void;
}

function SettingsCard({ uid, settings, onSaved }: SettingsCardProps) {
  const [editing, setEditing]   = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState('');

  // Local form state (only active while editing)
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
        {!editing && (
          <button
            onClick={startEdit}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        {editing ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SettingsField label="Store Name">
                <input
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </SettingsField>
              <SettingsField label="Cashier Name">
                <input
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="optional"
                />
              </SettingsField>
              <SettingsField label="Currency">
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </SettingsField>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-blue-600"
                  checked={allowLossSale}
                  onChange={(e) => setAllowLossSale(e.target.checked)}
                />
                Allow selling below cost price
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-blue-600"
                  checked={lowStockHighlight}
                  onChange={(e) => setLowStockHighlight(e.target.checked)}
                />
                Highlight low-stock products
              </label>
            </div>

            {saveError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                {saveError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-xl transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <SettingsReadRow label="Store Name"    value={settings.storeName} />
            <SettingsReadRow label="Cashier Name"  value={settings.cashierName ?? '—'} />
            <SettingsReadRow label="Currency"      value={settings.currency} />
            <SettingsReadRow label="Allow Loss Sale"      value={settings.allowLossSale ? 'Yes' : 'No'} />
            <SettingsReadRow label="Low Stock Highlight"  value={settings.lowStockHighlight ? 'On' : 'Off'} />
            <SettingsReadRow
              label="Last Updated"
              value={new Date(settings.updatedAt).toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</span>
      {children}
    </label>
  );
}

function SettingsReadRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-slate-400">{label}</span>
      <span className="font-medium text-slate-700">{value}</span>
    </div>
  );
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
