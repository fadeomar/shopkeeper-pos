'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/components/providers/auth-context';
import { fetchAllUsers, updateUserStatus, rejectUser, createAppUser } from '@/lib/firebase/auth-service';
import { fetchUserSummary, type SupportHealth, type UserSummary } from '@/lib/firebase/admin-service';
import type { AppUser } from '@/types/domain';

type SummaryMap = Record<string, UserSummary>;

const HEALTH_STYLES: Record<SupportHealth, string> = {
  healthy: 'bg-green-100 text-green-700',
  needs_attention: 'bg-amber-100 text-amber-700',
  no_backup: 'bg-red-100 text-red-600',
};

export default function AdminUsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [loading, setLoading] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function loadUsers() {
    try {
      setLoading(true);
      const list = await fetchAllUsers();
      const sorted = list.sort((a, b) => {
        const rank = (u: AppUser) => u.pendingApproval ? 0 : u.isActive ? 1 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
      setUsers(sorted);
      void loadSupportHealth(sorted);
    } catch {
      setError('Failed to load users. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  async function loadSupportHealth(list = users) {
    if (list.length === 0) return;
    setLoadingHealth(true);
    try {
      const entries = await Promise.all(
        list.map(async (u) => [u.uid, await fetchUserSummary(u.uid)] as const),
      );
      setSummaries(Object.fromEntries(entries));
    } catch {
      setError('Users loaded, but support health could not be refreshed.');
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function approve(uid: string) {
    try {
      await updateUserStatus(uid, true);
      setUsers((prev) => prev.map((u) =>
        u.uid === uid ? { ...u, isActive: true, pendingApproval: false } : u,
      ));
    } catch { setError('Failed to update user.'); }
  }

  async function reject(uid: string) {
    try {
      await rejectUser(uid);
      setUsers((prev) => prev.map((u) =>
        u.uid === uid ? { ...u, isActive: false, pendingApproval: false } : u,
      ));
    } catch { setError('Failed to update user.'); }
  }

  async function toggleActive(uid: string, current: boolean) {
    try {
      await updateUserStatus(uid, !current);
      setUsers((prev) => prev.map((u) =>
        u.uid === uid ? { ...u, isActive: !current, pendingApproval: false } : u,
      ));
    } catch { setError('Failed to update user.'); }
  }

  const dashboard = useMemo(() => {
    const summaryList = Object.values(summaries);
    return {
      totalUsers: users.length,
      pendingCount: users.filter((u) => u.pendingApproval).length,
      activeCount: users.filter((u) => !u.pendingApproval && u.isActive).length,
      needsAttention: summaryList.filter((s) => s.syncHealth !== 'healthy').length,
      totalRevenue: summaryList.reduce((sum, s) => sum + s.totalRevenue, 0),
      totalDebt: summaryList.reduce((sum, s) => sum + s.creditDebt, 0),
    };
  }, [users, summaries]);

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 bg-white border border-red-100 rounded-2xl text-center">
        <p className="font-semibold text-red-600 mb-1">Access Denied</p>
        <p className="text-sm text-slate-500">Only admins can manage users.</p>
      </div>
    );
  }

  const pending  = users.filter((u) => u.pendingApproval);
  const active   = users.filter((u) => !u.pendingApproval && u.isActive);
  const inactive = users.filter((u) => !u.pendingApproval && !u.isActive);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Admin Support Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Approve users, check backup health, and support seller data.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void loadSupportHealth()}
            disabled={loadingHealth || users.length === 0}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            {loadingHealth ? 'Refreshing…' : 'Refresh health'}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Add User
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <SupportCard label="Users" value={dashboard.totalUsers} />
        <SupportCard label="Pending" value={dashboard.pendingCount} tone={dashboard.pendingCount > 0 ? 'amber' : undefined} />
        <SupportCard label="Active" value={dashboard.activeCount} />
        <SupportCard label="Needs help" value={dashboard.needsAttention} tone={dashboard.needsAttention > 0 ? 'red' : undefined} />
        <SupportCard label="Cloud sales" value={dashboard.totalRevenue.toFixed(2)} />
        <SupportCard label="Customer debt" value={dashboard.totalDebt.toFixed(2)} tone={dashboard.totalDebt > 0 ? 'amber' : undefined} />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
          Loading users…
        </div>
      )}

      {showCreate && (
        <CreateUserForm
          onCreated={() => { setShowCreate(false); void loadUsers(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            Pending Approval ({pending.length})
          </h2>
          <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden divide-y divide-amber-50">
            {pending.map((u) => (
              <div key={u.uid} className="flex items-center gap-3 px-5 py-4">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 text-sm truncate">{u.name}</p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  {u.phone && (
                    <a href={`tel:${u.phone}`} className="text-xs text-blue-500 hover:underline">{u.phone}</a>
                  )}
                </div>
                <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                  {u.role}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => void approve(u.uid)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => void reject(u.uid)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(active.length > 0 || inactive.length > 0) && (
        <section>
          {pending.length > 0 && (
            <h2 className="text-sm font-semibold text-slate-500 mb-2">All Users</h2>
          )}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left px-5 py-3 font-medium text-slate-500">Name</th>
                    <th className="text-left px-5 py-3 font-medium text-slate-500 hidden md:table-cell">Health</th>
                    <th className="text-left px-5 py-3 font-medium text-slate-500 hidden lg:table-cell">Backup</th>
                    <th className="text-left px-5 py-3 font-medium text-slate-500 hidden sm:table-cell">Data</th>
                    <th className="text-left px-5 py-3 font-medium text-slate-500">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {[...active, ...inactive].map((u) => {
                    const summary = summaries[u.uid];
                    return (
                      <tr key={u.uid} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/admin/users/${u.uid}` as Route}
                            className="font-medium text-slate-800 hover:text-blue-600 transition-colors"
                          >
                            {u.name}
                          </Link>
                          {u.uid === currentUser?.uid && (
                            <span className="ml-2 text-xs text-slate-400">(you)</span>
                          )}
                          <div className="text-xs text-slate-400 truncate max-w-[220px]">{u.email}</div>
                          {u.phone && (
                            <div>
                              <a href={`tel:${u.phone}`} className="text-xs text-slate-400 hover:text-blue-500">{u.phone}</a>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3.5 hidden md:table-cell">
                          {summary ? <HealthBadge health={summary.syncHealth} /> : <span className="text-xs text-slate-300">Loading…</span>}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 hidden lg:table-cell whitespace-nowrap">
                          {summary?.lastSyncAt ? relativeTime(summary.lastSyncAt) : <span className="text-slate-300">No backup</span>}
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-500 hidden sm:table-cell whitespace-nowrap">
                          {summary ? `${summary.billCount} bills / ${summary.productCount} products` : '—'}
                          {summary && summary.creditDebt > 0 && (
                            <div className="text-amber-600">Debt {summary.creditDebt.toFixed(2)}</div>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                          }`}>
                            {u.isActive ? 'Active' : 'Inactive'}
                          </span>
                          <span className={`ml-1 hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          {u.uid !== currentUser?.uid && (
                            <button
                              onClick={() => void toggleActive(u.uid, u.isActive)}
                              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                u.isActive
                                  ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                  : 'bg-green-50 text-green-700 hover:bg-green-100'
                              }`}
                            >
                              {u.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {!loading && users.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-400">
          No users yet.
        </div>
      )}
    </div>
  );
}

function HealthBadge({ health }: { health: SupportHealth }) {
  const label = health === 'healthy' ? 'Healthy' : health === 'needs_attention' ? 'Needs attention' : 'No backup';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${HEALTH_STYLES[health]}`}>{label}</span>;
}

function SupportCard({ label, value, tone }: { label: string; value: string | number; tone?: 'amber' | 'red' }) {
  const toneClass = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-800';
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
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

function CreateUserForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'cashier'>('cashier');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await createAppUser(email, password, name, role, phone || undefined);
      onCreated();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      if (code === 'auth/email-already-in-use') setError('That email is already registered.');
      else if (code === 'auth/weak-password') setError('Password must be at least 6 characters.');
      else setError('Failed to create user. Check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
      <h2 className="font-semibold text-slate-800 mb-4">New User</h2>
      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Full Name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Jane Smith" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="jane@example.com" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Phone <span className="text-slate-400">(optional)</span></label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="+1 555 0123" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
          <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Min 6 characters" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'cashier')}
            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && (
          <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <button type="button" onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={loading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">
            {loading ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>
    </div>
  );
}
