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
  renewUserSubscription,
  suspendUserSubscription,
  markUserContacted,
} from "@/lib/firebase/auth-service";
import {
  fetchUserSummary,
  type SupportHealth,
  type UserSummary,
} from "@/lib/firebase/admin-service";
import type { AppUser, UserRole } from "@/types/domain";
import {
  getSubscriptionAccessState,
  subscriptionDaysRemaining,
  subscriptionExpiryDateLabel,
} from "@/lib/services/subscription-service";
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
      setError(t("admin.errorLoadUsers"));
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
      setError(t("admin.errorRefreshHealth"));
    } finally {
      setLoadingHealth(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    void loadUsers();
  // loadUsers is stable within this render; isAdmin is the real trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function approve(uid: string) {
    try {
      await updateUserStatus(uid, true);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid ? { ...u, isActive: true, pendingApproval: false } : u,
        ),
      );
    } catch {
      setError(t("admin.errorUpdateUser"));
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
      setError(t("admin.errorUpdateUser"));
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
      setError(t("admin.errorUpdateUser"));
    }
  }

  async function renewSubscription(uid: string, months: number) {
    try {
      const next = await renewUserSubscription(uid, months);
      setUsers((prev) => prev.map((u) => (u.uid === uid ? next : u)));
    } catch {
      setError(t("admin.errorRenewSubscription"));
    }
  }

  async function suspendSubscription(uid: string) {
    try {
      await suspendUserSubscription(uid);
      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid ? { ...u, subscriptionStatus: "suspended" } : u,
        ),
      );
    } catch {
      setError(t("admin.errorSuspendSubscription"));
    }
  }

  async function markContacted(uid: string) {
    try {
      const contactedAt = new Date().toISOString();
      await markUserContacted(uid);
      setUsers((prev) =>
        prev.map((u) => (u.uid === uid ? { ...u, contactedAt } : u)),
      );
    } catch {
      setError(t("admin.errorContacted"));
    }
  }

  const dashboard = useMemo(() => {
    const summaryList = Object.values(summaries);
    return {
      totalUsers: users.length,
      pendingCount: users.filter((u) => u.pendingApproval).length,
      activeCount: users.filter((u) => !u.pendingApproval && u.isActive).length,
      trialCount: users.filter((u) => u.accountType === "trial" || u.subscriptionStatus === "trial").length,
      expiredCount: users.filter((u) => {
        const state = getSubscriptionAccessState(u);
        return state === "expired" || state === "suspended";
      }).length,
      needsAttention: summaryList.filter((s) => s.syncHealth !== "healthy")
        .length,
      totalRevenue: summaryList.reduce((sum, s) => sum + s.totalRevenue, 0),
      totalPurchases: summaryList.reduce((sum, s) => sum + s.purchaseCount, 0),
      totalDebt: summaryList.reduce((sum, s) => sum + s.creditDebt, 0),
      totalSupplierDebt: summaryList.reduce((sum, s) => sum + s.supplierDebt, 0),
    };
  }, [users, summaries]);

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto mt-12 p-6 bg-white border border-danger/20 rounded-2xl text-center">
        <p className="font-semibold text-danger mb-1">{t("admin.accessDenied")}</p>
        <p className="text-sm text-slate-500">{t("admin.onlyAdminsManage")}</p>
      </div>
    );
  }

  const pending = users.filter((u) => u.pendingApproval);
  const active = users.filter((u) => !u.pendingApproval && u.isActive);
  const inactive = users.filter((u) => !u.pendingApproval && !u.isActive);
  const managedUsers = [...active, ...inactive];

  const userColumns: ColumnDef<AppUser>[] = [
    {
      header: t("products.name"),
      accessorKey: "name",
      cell: ({ row }) => {
        const u = row.original;
        return (
          <div className="min-w-[220px]">
            <Link
              href={`/admin/users/${u.uid}` as Route}
              className="font-medium text-slate-800 transition-colors hover:text-info"
            >
              {u.name}
            </Link>
            {u.uid === currentUser?.uid && (
              <span className="ms-2 text-xs text-slate-400">
                ({t("common.self")})
              </span>
            )}
            <div className="truncate text-xs text-slate-400">{u.email}</div>
            {u.phone && (
              <a
                href={`tel:${u.phone}`}
                className="text-xs text-slate-400 hover:text-info"
              >
                {u.phone}
              </a>
            )}
          </div>
        );
      },
    },
    {
      header: t("admin.backupHealth"),
      id: "health",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        return summary ? (
          <HealthBadge health={summary.syncHealth} />
        ) : (
          <span className="text-xs text-slate-300">{t("common.loading")}</span>
        );
      },
    },
    {
      header: t("settings.cloudBackup"),
      id: "backup",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        return summary?.lastSyncAt ? (
          relativeTime(summary.lastSyncAt, t)
        ) : (
          <span className="text-slate-300">{t("admin.noBackup")}</span>
        );
      },
    },
    {
      header: t("admin.cloudStats"),
      id: "data",
      cell: ({ row }) => {
        const summary = summaries[row.original.uid];
        if (!summary) return "—";
        return (
          <div className="whitespace-nowrap text-xs text-slate-500">
            {summary.billCount} {t("bills.title")} / {summary.productCount}{" "}
            {t("products.title")}
            {summary.creditDebt > 0 && (
              <div className="text-warning">
                {t("admin.customerDebt")} {summary.creditDebt.toFixed(2)}
              </div>
            )}
          </div>
        );
      },
    },
    {
      header: t("admin.subscription"),
      id: "subscription",
      cell: ({ row }) => <SubscriptionCell user={row.original} />,
    },

    {
      header: t("bills.status"),
      accessorKey: "isActive",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={row.original.isActive ? "success" : "danger"}>
            {row.original.isActive ? t("common.active") : t("common.inactive")}
          </Badge>
          <Badge>{row.original.role}</Badge>
        </div>
      ),
    },
    {
      header: t("bills.actions"),
      id: "actions",
      enableSorting: false,
      cell: ({ row }) => {
        const u = row.original;
        if (u.uid === currentUser?.uid)
          return (
            <span className="text-xs text-slate-400">{t("common.self")}</span>
          );
        return (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="success"
              onClick={() => void renewSubscription(u.uid, 1)}
            >
              {t("admin.renewOneMonth")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void renewSubscription(u.uid, 3)}
            >
              {t("admin.renewThreeMonths")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void markContacted(u.uid)}
            >
              {t("admin.markContacted")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={u.isActive ? "danger" : "success"}
              onClick={() => void toggleActive(u.uid, u.isActive)}
            >
              {u.isActive ? t("admin.deactivate") : t("admin.reactivate")}
            </Button>
            {u.subscriptionStatus !== "suspended" && (
              <Button
                type="button"
                size="sm"
                variant="danger"
                onClick={() => void suspendSubscription(u.uid)}
              >
                {t("admin.suspendSubscription")}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <PageShell size="wide">
      <PageHeader
        title={t("admin.usersTitle")}
        description={t("admin.usersSubtitle")}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => void loadSupportHealth()}
              disabled={loadingHealth || users.length === 0}
            >
              {loadingHealth ? t("common.loading") : t("admin.refreshHealth")}
            </Button>
            <Button type="button" onClick={() => setShowCreate(true)}>
              {t("admin.newUser")}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 xl:grid-cols-10 gap-3">
        <SupportCard
          label={t("admin.totalUsers")}
          value={dashboard.totalUsers}
        />
        <SupportCard
          label={t("admin.pendingCount")}
          value={dashboard.pendingCount}
          tone={dashboard.pendingCount > 0 ? "amber" : undefined}
        />
        <SupportCard
          label={t("admin.activeCount")}
          value={dashboard.activeCount}
        />
        <SupportCard
          label={t("admin.trialCount")}
          value={dashboard.trialCount}
          tone={dashboard.trialCount > 0 ? "amber" : undefined}
        />
        <SupportCard
          label={t("admin.expiredCount")}
          value={dashboard.expiredCount}
          tone={dashboard.expiredCount > 0 ? "red" : undefined}
        />
        <SupportCard
          label={t("admin.needsHelp")}
          value={dashboard.needsAttention}
          tone={dashboard.needsAttention > 0 ? "red" : undefined}
        />
        <SupportCard
          label={t("admin.netSales")}
          value={dashboard.totalRevenue.toFixed(2)}
        />
        <SupportCard
          label={t("admin.cloudPurchases")}
          value={dashboard.totalPurchases}
        />
        <SupportCard
          label={t("admin.customerDebt")}
          value={dashboard.totalDebt.toFixed(2)}
          tone={dashboard.totalDebt > 0 ? "amber" : undefined}
        />
        <SupportCard
          label={t("admin.supplierDebt")}
          value={dashboard.totalSupplierDebt.toFixed(2)}
          tone={dashboard.totalSupplierDebt > 0 ? "amber" : undefined}
        />
      </div>

      {error && (
        <p className="text-sm text-danger bg-danger-soft border border-danger/20 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading && <LoadingState title={t("admin.loadingUsers")} />}

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
          <h2 className="text-sm font-semibold text-warning mb-2 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-warning inline-block" />
            {t("admin.pendingApproval")} ({pending.length})
          </h2>
          <div className="bg-white border border-warning/20 rounded-2xl overflow-hidden divide-y divide-warning/10">
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
                      className="text-xs text-info hover:underline"
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
                    {t("admin.approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void reject(u.uid)}
                  >
                    {t("admin.reject")}
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
          title={pending.length > 0 ? t("admin.allUsers") : t("admin.users")}
          description={t("admin.usersTableDesc")}
          emptyTitle={t("admin.noUsersFound")}
          searchPlaceholder={t("admin.searchUsers")}
          labels={{
            searchPlaceholder: t("admin.searchUsers"),
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

      {!loading && users.length === 0 && <EmptyState title={t("admin.noUsers")} />}
    </PageShell>
  );
}


function SubscriptionCell({ user }: { user: AppUser }) {
  const { t } = useLocale();
  const state = getSubscriptionAccessState(user);
  const days = subscriptionDaysRemaining(user);
  const isTrial = user.accountType === "trial" || user.subscriptionStatus === "trial";
  const accountLabel = !user.subscriptionStatus
    ? t("admin.legacyAccount")
    : isTrial
      ? t("admin.trialAccount")
      : t("admin.standardAccount");
  const tone =
    state === "active" || state === "legacy"
      ? "success"
      : state === "trial"
        ? "warning"
        : "danger";
  const statusLabel =
    state === "expired"
      ? t("admin.expired")
      : state === "suspended"
        ? t("admin.suspended")
        : state === "trial"
          ? t("admin.trialAccount")
          : state === "legacy"
            ? t("admin.legacyAccount")
            : t("common.active");

  return (
    <div className="min-w-[180px] space-y-1">
      <div className="flex flex-wrap gap-1">
        <Badge tone={tone}>{statusLabel}</Badge>
        <Badge>{accountLabel}</Badge>
      </div>
      <div className="text-xs text-slate-500">
        {user.subscriptionEndAt ? (
          <>
            {t("admin.expires")}: {subscriptionExpiryDateLabel(user)}
            {typeof days === "number" && days >= 0 && (
              <span className="ms-1 text-slate-400">
                ({t("admin.daysLeft", { count: days })})
              </span>
            )}
          </>
        ) : (
          "—"
        )}
      </div>
      <div className="text-xs text-slate-400">
        {user.contactedAt
          ? `${t("admin.contacted")} ${user.contactedAt.slice(0, 10)}`
          : t("admin.notContacted")}
      </div>
    </div>
  );
}

function HealthBadge({ health }: { health: SupportHealth }) {
  const { t } = useLocale();
  const label =
    health === "healthy"
      ? t("admin.healthy")
      : health === "needs_attention"
        ? t("admin.needsAttention")
        : t("admin.noBackup");
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
      ? "text-danger"
      : tone === "amber"
        ? "text-warning"
        : "text-slate-800";
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

type TFn = ReturnType<typeof useLocale>["t"];

function relativeTime(value: string, t: TFn): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return t("admin.timeUnknown");
  const diffMs = Date.now() - time;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t("admin.timeJustNow");
  if (minutes < 60) return t("admin.timeMinutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("admin.timeHoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("admin.timeDaysAgo", { count: days });
}

function CreateUserForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("cashier");
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
        setError(t("admin.errorEmailExists"));
      else if (code === "auth/weak-password")
        setError(t("admin.errorPasswordShort"));
      else setError(t("admin.errorCreateUser"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionCard title={t("admin.newUserTitle")}>
      <form
        onSubmit={handleSubmit}
        className="grid grid-cols-1 sm:grid-cols-2 gap-4"
      >
        <FormField label={t("admin.fullName")}>
          <Input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("admin.fullNamePlaceholder")}
          />
        </FormField>
        <FormField label={t("admin.email")}>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("admin.emailPlaceholder")}
          />
        </FormField>
        <FormField
          label={
            <span>
              {t("admin.phone")}{" "}
              <span className="text-slate-400">{t("admin.optional")}</span>
            </span>
          }
        >
          <Input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t("admin.phonePlaceholder")}
          />
        </FormField>
        <FormField label={t("admin.password")}>
          <Input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("admin.passwordPlaceholder")}
          />
        </FormField>
        <FormField label={t("admin.role")}>
          <SearchableSelect
            value={role}
            onValueChange={(value) =>
              setRole((value as UserRole) ?? "cashier")
            }
            options={[
              { value: "cashier", label: t("admin.roleCashier") },
              { value: "manager", label: t("admin.roleManager") },
              { value: "accountant", label: t("admin.roleAccountant") },
              { value: "owner", label: t("admin.roleOwner") },
            ]}
            placeholder={t("admin.selectRole")}
            searchPlaceholder={t("admin.searchRoles")}
            emptyMessage={t("admin.noRoles")}
          />
        </FormField>
        {error && (
          <p className="sm:col-span-2 text-sm text-danger bg-danger-soft border border-danger/20 rounded-xl px-3 py-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2 flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={loading}>
            {loading ? t("admin.creating") : t("admin.createUser")}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
