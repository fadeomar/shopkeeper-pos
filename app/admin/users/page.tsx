"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useAuth } from "@/components/providers/auth-context";
import { useLocale } from "@/components/providers/locale-context";
import {
  fetchAllUsers,
  updateUserStatus,
  rejectUser,
  createAppUser,
} from "@/lib/firebase/auth-service";
import {
  fetchUserSummary,
  type SupportHealth,
  type UserSummary,
} from "@/lib/firebase/admin-service";
import type { AppUser } from "@/types/domain";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import type { ColumnDef } from "@tanstack/react-table";

type SummaryMap = Record<string, UserSummary>;

const HEALTH_STYLES: Record<SupportHealth, string> = {
  healthy: "bg-green-100 text-green-700",
  needs_attention: "bg-amber-100 text-amber-700",
  no_backup: "bg-red-100 text-red-600",
};

export default function AdminUsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const { t } = useLocale();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [summaries, setSummaries] = useState<SummaryMap>({});
  const [loading, setLoading] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function loadUsers() {
    try {
      setLoading(true);
      const list = await fetchAllUsers();
      const sorted = list.sort((a, b) => {
        const rank = (u: AppUser) =>
          u.pendingApproval ? 0 : u.isActive ? 1 : 2;
        return rank(a) - rank(b) || a.name.localeCompare(b.name);
      });
      setUsers(sorted);
      void loadSupportHealth(sorted);
    } catch {
      setError("Failed to load users. Check your connection.");
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
      setError("Users loaded, but support health could not be refreshed.");
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function approve(uid: string) {
    try {
      await updateUserStatus(uid, true);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid ? { ...u, isActive: true, pendingApproval: false } : u,
        ),
      );
    } catch {
      setError("Failed to update user.");
    }
  }

  async function reject(uid: string) {
    try {
      await rejectUser(uid);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid ? { ...u, isActive: false, pendingApproval: false } : u,
        ),
      );
    } catch {
      setError("Failed to update user.");
    }
  }

  async function toggleActive(uid: string, current: boolean) {
    try {
      await updateUserStatus(uid, !current);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? { ...u, isActive: !current, pendingApproval: false }
            : u,
        ),
      );
    } catch {
      setError("Failed to update user.");
    }
  }

  const dashboard = useMemo(() => {
    const summaryList = Object.values(summaries);
    return {
      totalUsers: users.length,
      pendingCount: users.filter((u) => u.pendingApproval).length,
      activeCount: users.filter((u) => !u.pendingApproval && u.isActive).length,
      needsAttention: summaryList.filter((s) => s.syncHealth !== "healthy")
        .length,
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

  const pending = users.filter((u) => u.pendingApproval);
  const active = users.filter((u) => !u.pendingApproval && u.isActive);
  const inactive = users.filter((u) => !u.pendingApproval && !u.isActive);
  const managedUsers = [...active, ...inactive];

  const userColumns: ColumnDef<AppUser>[] = [
    {
      header: "Name",
      accessorKey: "name",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="min-w-[220px]">
            <Link
              href={`/admin/users/${u.uid}` as Route}
              className="font-medium text-slate-800 transition-colors hover:text-blue-600"
            >
              {u.name}
            </Link>
            {u.uid === currentUser?.uid && (
              <span className="ms-2 text-xs text-slate-400">(you)</span>
            )}
            <div className="truncate text-xs text-slate-400">{u.email}</div>
            {u.phone && (
              <a href={`tel:${u.phone}`} className="text-xs text-slate-400 hover:text-blue-500">
                {u.phone}
              </a>
            )}
          </div>
        );
      },
    },
    {
      header: "Health",
      id: "health",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        return summary ? <HealthBadge health={summary.syncHealth} /> : <span className="text-xs text-slate-300">Loading…</span>;
      },
    },
    {
      header: "Backup",
      id: "backup",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        return summary?.lastSyncAt ? relativeTime(summary.lastSyncAt) : <span className="text-slate-300">No backup</span>;
      },
    },
    {
      header: "Data",
      id: "data",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        if (!summary) return "—";
        return (
          <div className="whitespace-nowrap text-xs text-slate-500">
            {summary.billCount} bills / {summary.productCount} products
            {summary.creditDebt > 0 && <div className="text-amber-600">Debt {summary.creditDebt.toFixed(2)}</div>}
          </div>
        );
      },
    },
    {
      header: "Status",
      accessorKey: "isActive",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={row.original.isActive ? "success" : "danger"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
          <Badge>{row.original.role}</Badge>
        </div>
      ),
    },
    {
      header: "Actions",
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        if (u.uid === currentUser?.uid) return <span className="text-xs text-slate-400">Current user</span>;
        return (
          <Button
            type="button"
            size="sm"
            variant={u.isActive ? "danger" : "success"}
            onClick={() => void toggleActive(u.uid, u.isActive)}
          >
            {u.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        );
      },
    },
  ];

  return (
    <PageShell size="wide">
      <PageHeader
        title="Admin Support Dashboard"
        description="Approve users, check backup health, and support seller data."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadSupportHealth()}
              disabled={loadingHealth || users.length === 0}
            >
              {loadingHealth ? "Refreshing…" : "Refresh health"}
            </Button>
            <Button type="button" onClick={() => setShowCreate(true)}>
              Add User
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <SupportCard label="Users" value={dashboard.totalUsers} />
        <SupportCard
          label="Pending"
          value={dashboard.pendingCount}
          tone={dashboard.pendingCount > 0 ? "amber" : undefined}
        />
        <SupportCard label="Active" value={dashboard.activeCount} />
        <SupportCard
          label="Needs help"
          value={dashboard.needsAttention}
          tone={dashboard.needsAttention > 0 ? "red" : undefined}
        />
        <SupportCard
          label="Cloud sales"
          value={dashboard.totalRevenue.toFixed(2)}
        />
        <SupportCard
          label="Customer debt"
          value={dashboard.totalDebt.toFixed(2)}
          tone={dashboard.totalDebt > 0 ? "amber" : undefined}
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading && <LoadingState title="Loading users…" />}

      {showCreate && (
        <CreateUserForm
          onCreated={() => {
            setShowCreate(false);
            void loadUsers();
          }}
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
                  <p className="font-medium text-slate-800 text-sm truncate">
                    {u.name}
                  </p>
                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  {u.phone && (
                    <a
                      href={`tel:${u.phone}`}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      {u.phone}
                    </a>
                  )}
                </div>
                <Badge className="hidden sm:inline-flex">{u.role}</Badge>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="success"
                    onClick={() => void approve(u.uid)}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void reject(u.uid)}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(active.length > 0 || inactive.length > 0) && (
        <DataTable
          columns={userColumns}
          data={managedUsers}
          title={pending.length > 0 ? "All Users" : "Users"}
          description="Search, review backup health, and manage account status."
          emptyTitle="No users found."
          searchPlaceholder="Search users…"
          labels={{
            searchPlaceholder: "Search users…",
            loading: t("dataTable.loading"),
            page: t("dataTable.page"),
            of: t("dataTable.of"),
            rowsPerPage: t("dataTable.rowsPerPage"),
            first: t("dataTable.first"),
            previous: t("dataTable.previous"),
            next: t("dataTable.next"),
            last: t("dataTable.last"),
          }}
          pageSize={10}
          getRowId={(row) => row.uid}
        />
      )}

      {!loading && users.length === 0 && <EmptyState title="No users yet." />}
    </PageShell>
  );
}

function HealthBadge({ health }: { health: SupportHealth }) {
  const label =
    health === "healthy"
      ? "Healthy"
      : health === "needs_attention"
        ? "Needs attention"
        : "No backup";
  return (
    <Badge
      tone={
        health === "healthy"
          ? "success"
          : health === "needs_attention"
            ? "warning"
            : "danger"
      }
    >
      {label}
    </Badge>
  );
}

function SupportCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "amber" | "red";
}) {
  const toneClass =
    tone === "red"
      ? "text-red-600"
      : tone === "amber"
        ? "text-amber-600"
        : "text-slate-800";
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Unknown";
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await createAppUser(email, password, name, role, phone || undefined);
      onCreated();
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use")
        setError("That email is already registered.");
      else if (code === "auth/weak-password")
        setError("Password must be at least 6 characters.");
      else setError("Failed to create user. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title="New User">
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <FormField label="Full Name">
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
          />
        </FormField>
        <FormField label="Email">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jane@example.com"
          />
        </FormField>
        <FormField
          label={
            <span>
              Phone <span className="text-slate-400">(optional)</span>
            </span>
          }
        >
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 555 0123"
          />
        </FormField>
        <FormField label="Password">
          <Input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Min 6 characters"
          />
        </FormField>
        <FormField label="Role">
          <SearchableSelect
            value={role}
            onValueChange={(value) => setRole((value as "admin" | "cashier") ?? "cashier")}
            options={[
              { value: "cashier", label: "Cashier" },
              { value: "admin", label: "Admin" },
            ]}
            placeholder="Select role"
            searchPlaceholder="Search roles…"
            emptyMessage="No roles found"
          />
        </FormField>
        {error && (
          <p className="sm:col-span-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? "Creating…" : "Create User"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
