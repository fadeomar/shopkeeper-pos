'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/components/providers/auth-context';
import { fetchAllUsers, updateUserStatus, rejectUser, createAppUser } from '@/lib/firebase/auth-service';
import { fetchUserSummary, type SupportHealth, type UserSummary } from '@/lib/firebase/admin-service';
import type { AppUser } from '@/types/domain';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { SectionCard } from '@/components/ui/section-card';
import { TableShell } from '@/components/ui/table-shell';
import { Toolbar } from '@/components/ui/toolbar';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/loading-state';
import { alertTones, panelTones, typographyClasses } from '@/lib/design/variants';
import clsx from 'clsx';

type SummaryMap = Record<string, UserSummary>;

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
      <PageShell>
        <SectionCard tone="danger" title="Access Denied" description="Only admins can manage users.">
          <p className={typographyClasses.bodyMuted}>Sign in with an admin account to continue.</p>
        </SectionCard>
      </PageShell>
    );
  }

  const pending  = users.filter((u) => u.pendingApproval);
  const active   = users.filter((u) => !u.pendingApproval && u.isActive);
  const inactive = users.filter((u) => !u.pendingApproval && !u.isActive);

  return (
    <PageShell>
      <PageHeader
        title="Admin Support Dashboard"
        description="Approve users, check backup health, and support seller data."
        actions={(
          <Toolbar align="end">
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadSupportHealth()}
              disabled={loadingHealth || users.length === 0}
              loading={loadingHealth}
            >
              {loadingHealth ? 'Refreshing…' : 'Refresh health'}
            </Button>
            <Button type="button" onClick={() => setShowCreate(true)}>
              Add User
            </Button>
          </Toolbar>
        )}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SupportCard label="Users" value={dashboard.totalUsers} />
        <SupportCard label="Pending" value={dashboard.pendingCount} tone={dashboard.pendingCount > 0 ? 'warning' : undefined} />
        <SupportCard label="Active" value={dashboard.activeCount} />
        <SupportCard label="Needs help" value={dashboard.needsAttention} tone={dashboard.needsAttention > 0 ? 'danger' : undefined} />
        <SupportCard label="Cloud sales" value={dashboard.totalRevenue.toFixed(2)} />
        <SupportCard label="Customer debt" value={dashboard.totalDebt.toFixed(2)} tone={dashboard.totalDebt > 0 ? 'warning' : undefined} />
      </div>

      {error && <p className={clsx('rounded-xl border px-4 py-3 text-sm', alertTones.danger)}>{error}</p>}

      {loading && <LoadingState title="Loading users…" />}

      {showCreate && (
        <CreateUserForm
          onCreated={() => { setShowCreate(false); void loadUsers(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {pending.length > 0 && (
        <SectionCard
          tone="warning"
          title={`Pending Approval (${pending.length})`}
          description="Review new account requests before they can access the POS."
        >
          <div className="divide-y divide-amber-100 overflow-hidden rounded-2xl border border-amber-100 bg-white">
            {pending.map((u) => (
              <div key={u.uid} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{u.name}</p>
                  <p className="truncate text-xs text-slate-500">{u.email}</p>
                  {u.phone && <a href={`tel:${u.phone}`} className="text-xs text-blue-600 hover:underline">{u.phone}</a>}
                </div>
                <Badge tone="neutral">{u.role}</Badge>
                <div className="flex gap-2 sm:justify-end">
                  <Button type="button" size="sm" variant="success" onClick={() => void approve(u.uid)}>
                    Approve
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => void reject(u.uid)}>
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {(active.length > 0 || inactive.length > 0) && (
        <TableShell
          title="All Users"
          description="Monitor account status, support health, and recent cloud backup state."
        >
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={typographyClasses.tableHeader}>Name</th>
                <th className={typographyClasses.tableHeader}>Health</th>
                <th className={typographyClasses.tableHeader}>Backup</th>
                <th className={typographyClasses.tableHeader}>Data</th>
                <th className={typographyClasses.tableHeader}>Status</th>
                <th className={typographyClasses.tableHeader} />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[...active, ...inactive].map((u) => {
                const summary = summaries[u.uid];
                return (
                  <tr key={u.uid} className="transition-colors hover:bg-slate-50">
                    <td className={typographyClasses.tableCell}>
                      <Link href={`/admin/users/${u.uid}` as Route} className="font-medium text-slate-800 hover:text-blue-600">
                        {u.name}
                      </Link>
                      {u.uid === currentUser?.uid && <span className="ms-2 text-xs text-slate-400">(you)</span>}
                      <div className="max-w-[220px] truncate text-xs text-slate-400">{u.email}</div>
                      {u.phone && <a href={`tel:${u.phone}`} className="text-xs text-slate-400 hover:text-blue-500">{u.phone}</a>}
                    </td>
                    <td className={typographyClasses.tableCell}>
                      {summary ? <HealthBadge health={summary.syncHealth} /> : <span className="text-xs text-slate-300">Loading…</span>}
                    </td>
                    <td className={clsx(typographyClasses.tableCell, 'whitespace-nowrap')}>
                      {summary?.lastSyncAt ? relativeTime(summary.lastSyncAt) : <span className="text-slate-300">No backup</span>}
                    </td>
                    <td className={clsx(typographyClasses.tableCell, 'whitespace-nowrap text-xs')}>
                      {summary ? `${summary.billCount} bills / ${summary.productCount} products` : '—'}
                      {summary && summary.creditDebt > 0 && <div className="text-amber-600">Debt {summary.creditDebt.toFixed(2)}</div>}
                    </td>
                    <td className={clsx(typographyClasses.tableCell, 'space-x-1 rtl:space-x-reverse')}>
                      <StatusPill status={u.isActive ? 'online' : 'error'} label={u.isActive ? 'Active' : 'Inactive'} />
                      <Badge tone={u.role === 'admin' ? 'info' : 'neutral'}>{u.role}</Badge>
                    </td>
                    <td className={clsx(typographyClasses.tableCell, 'text-end')}>
                      {u.uid !== currentUser?.uid && (
                        <Button
                          type="button"
                          size="sm"
                          variant={u.isActive ? 'danger' : 'success'}
                          onClick={() => void toggleActive(u.uid, u.isActive)}
                        >
                          {u.isActive ? 'Deactivate' : 'Reactivate'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      )}

      {!loading && users.length === 0 && <EmptyState title="No users yet." description="Create the first app user to start managing access." />}
    </PageShell>
  );
}

function HealthBadge({ health }: { health: SupportHealth }) {
  const label = health === 'healthy' ? 'Healthy' : health === 'needs_attention' ? 'Needs attention' : 'No backup';
  const tone = health === 'healthy' ? 'success' : health === 'needs_attention' ? 'warning' : 'danger';
  return <Badge tone={tone}>{label}</Badge>;
}

function SupportCard({ label, value, tone }: { label: string; value: string | number; tone?: 'warning' | 'danger' }) {
  return (
    <SectionCard padding="sm" className="gap-1">
      <p className={typographyClasses.statLabel}>{label}</p>
      <p className={clsx('tabular-nums', typographyClasses.statValue, tone === 'danger' && 'text-red-600', tone === 'warning' && 'text-amber-600')}>{value}</p>
    </SectionCard>
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
    <SectionCard title="New User" description="Create an admin or cashier account.">
      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField label="Full Name" required>
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" />
        </FormField>
        <FormField label="Email" required>
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" />
        </FormField>
        <FormField label="Phone" hint="Optional">
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 0123" />
        </FormField>
        <FormField label="Password" required>
          <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" />
        </FormField>
        <FormField label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'cashier')}>
            <option value="cashier">Cashier</option>
            <option value="admin">Admin</option>
          </Select>
        </FormField>
        {error && <p className={clsx('rounded-xl border px-3 py-2 text-sm sm:col-span-2', alertTones.danger)}>{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={loading} loading={loading}>{loading ? 'Creating…' : 'Create User'}</Button>
        </div>
      </form>
    </SectionCard>
  );
}
