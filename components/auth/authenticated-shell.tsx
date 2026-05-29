"use client";

import { useState, useEffect, useId, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, usePathname } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/components/providers/auth-context";
import { useLocale } from "@/components/providers/locale-context";
import { signIn, registerUser } from "@/lib/firebase/auth-service";
import { syncAllToCloud, type SyncMeta } from "@/lib/firebase/sync-service";
import { getPendingSyncCount } from "@/lib/services/sync-queue-service";
import { getOpenConflicts } from "@/lib/services/sync-conflict-service";
import {
  fetchSyncMeta,
  isLocalDbEmpty,
  restoreFromCloud,
  pullSettingsFromCloud,
  getRestoreErrorMessage,
} from "@/lib/firebase/restore-service";
import { db } from "@/lib/db/schema";
import { DbBootstrap } from "@/components/providers/db-bootstrap";
import { AppSidebarBrand } from "@/components/app-sidebar-brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { useSettings } from "@/components/providers/settings-context";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getLocalDataSummary,
  saveCurrentAccountSnapshot,
} from "@/lib/services/account-data-service";
import { setRestoreDecisionPending } from "@/lib/services/sync-gate";
import { SyncStatusBadge } from "@/components/sync/sync-status-badge";
import { ConflictResolverModal } from "@/components/sync/conflict-resolver-modal";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

export function AuthenticatedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status, user, logout } = useAuth();
  if (status === "loading") return <LoadingScreen />;
  if (status === "unauthenticated") return <AuthScreen />;
  if (status === "pending") return <PendingScreen onLogout={logout} />;
  if (status === "inactive") return <InactiveScreen onLogout={logout} />;

  // Authenticated — split by role
  if (user?.role === "owner") return <AdminShell>{children}</AdminShell>;
  return <CashierShell>{children}</CashierShell>;
}

// ─── Admin shell ─────────────────────────────────────────────────────────────
// No DbBootstrap — admin reads only from Firestore, never from local IndexedDB.
// Auto-redirects to /admin/users if landed on a POS route.

function AdminShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!pathname.startsWith("/admin")) {
      router.replace("/admin/users" as Route);
    }
  }, [pathname, router]);

  // Show loading spinner briefly while redirect fires
  if (!pathname.startsWith("/admin")) return <LoadingScreen />;

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr] bg-slate-50">
      {/* Skip-to-content: visually hidden until focused by keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-brand focus:text-white focus:rounded-xl focus:font-medium focus:text-sm"
      >
        {t("nav.skipToContent")}
      </a>

      <aside className="bg-slate-900 text-white flex flex-col lg:min-h-screen lg:sticky lg:top-0">
        <div className="hidden lg:block px-5 pt-6 pb-4">
          <AppSidebarBrand />
        </div>
        <div className="flex lg:hidden items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="font-bold text-base tracking-tight">
            Shopkeeper POS
          </span>
          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
            Admin
          </span>
          <SafeSignOutButton className="ms-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors" />
        </div>

        <nav
          aria-label={t("nav.adminNavLabel")}
          className="flex flex-row overflow-x-auto gap-1 px-3 py-2 lg:flex-col lg:overflow-x-visible lg:flex-1"
        >
          <Link
            href={"/admin/users" as Route}
            aria-current={pathname.startsWith("/admin") ? "page" : undefined}
            className={clsx(
              "whitespace-nowrap px-3 py-2 rounded-xl text-sm font-medium transition-colors lg:w-full",
              pathname.startsWith("/admin")
                ? "bg-brand text-white"
                : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
          >
            {t("admin.users")}
          </Link>
        </nav>

        <div className="hidden lg:block px-4 pb-5 mt-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-400 truncate">
              {user?.name}
            </span>
            <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-full shrink-0">
              Admin
            </span>
          </div>
          <div className="text-xs text-slate-500 mb-3 truncate">
            {user?.email}
          </div>
          <SafeSignOutButton className="w-full text-start text-xs text-slate-400 hover:text-white transition-colors" />
        </div>
      </aside>

      <main id="main-content" className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
        {children}
      </main>
    </div>
  );
}

// ─── Cashier shell ────────────────────────────────────────────────────────────
// Full POS shell with local IndexedDB (DbBootstrap), reconnect sync,
// daily auto-sync, and new-device cloud restore detection.

function CashierShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { t } = useLocale();
  const { setSettings } = useSettings();
  const uid = user?.uid;

  // Restore flow state
  const [cloudMeta, setCloudMeta] = useState<SyncMeta | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [restoreSkipped, setRestoreSkipped] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreStep, setRestoreStep] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const checkRan = useRef<string | null>(null);

  // One-time new-device detection per uid (resets if uid ever changes).
  // While the check runs, we close the sync-gate so background runSync ticks
  // don't pull cloud rows into a still-being-decided local DB. The gate
  // reopens in every branch of runRestoreCheck (success, skip, no-meta, or
  // error) via the finally.
  useEffect(() => {
    if (!uid || checkRan.current === uid) return;
    checkRan.current = uid;
    setRestoreDecisionPending(true);
    void runRestoreCheck(uid).finally(() => setRestoreDecisionPending(false));
  }, [uid]);

  async function runRestoreCheck(userId: string) {
    try {
      // Account-switch guard: if the device was last used by a different UID,
      // wipe local Dexie so the incoming user starts fresh and gets a fair
      // restore offer — rather than briefly seeing the previous user's data.
      try {
        const lastUid = localStorage.getItem('shopkeeper_last_active_uid');
        if (lastUid && lastUid !== userId) {
          await db.transaction('rw', db.tables, async () => {
            await Promise.all(db.tables.map((t) => t.clear()));
          });
          localStorage.setItem('shopkeeper_last_active_uid', userId);
        }
      } catch {
        // Non-fatal — if the wipe fails, proceed with whatever is in IndexedDB.
      }

      const empty = await isLocalDbEmpty();
      if (empty) {
        const meta = await fetchSyncMeta(userId);
        // Restore is worth offering if ANY business collection has data on
        // the cloud — not just bills/products. Accounts that started in
        // purchases (buy-side first), did supplier-only setup, recorded
        // shifts or cash drawer events before any sales, or only tracked
        // expenses would all be skipped by the old bills-or-products check.
        const hasCloudData =
          !!meta &&
          Object.values(meta.recordCounts).some(
            (count) => typeof count === 'number' && count > 0,
          );
        if (hasCloudData && meta) {
          const skippedBackup = readSkippedRestoreMeta(userId);
          if (skippedBackup === meta.lastSyncedAt) {
            setRestoreSkipped(true);
            setRestoreChecked(true);
            return;
          }
          setCloudMeta(meta);
          return; // show restore modal — don't mark as checked yet
        }
      }
    } catch {
      /* offline or error — skip restore check silently */
    }
    setRestoreChecked(true);
  }

  function readSkippedRestoreMeta(userId: string): string | null {
    try {
      return localStorage.getItem(`shopkeeper_restore_skipped_${userId}`);
    } catch {
      return null;
    }
  }

  function rememberSkippedRestore(userId: string, meta: SyncMeta | null) {
    if (!meta) return;
    try {
      localStorage.setItem(
        `shopkeeper_restore_skipped_${userId}`,
        meta.lastSyncedAt,
      );
    } catch {
      /* non-fatal */
    }
  }

  function clearSkippedRestore(userId: string) {
    try {
      localStorage.removeItem(`shopkeeper_restore_skipped_${userId}`);
    } catch {
      /* non-fatal */
    }
  }

  async function clearAppCaches() {
    if (typeof window === "undefined" || !("caches" in window)) return;
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("sk-"))
          .map((key) => caches.delete(key)),
      );
    } catch {
      /* cache cleanup is best effort */
    }
  }

  function requestQueueSync() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event("shopkeeper:sync-requested"));
  }

  async function runSafeFullSync(userId: string) {
    const [pendingCount, openConflicts] = await Promise.all([
      getPendingSyncCount(),
      getOpenConflicts(),
    ]);

    if (pendingCount > 0 || openConflicts.length > 0) {
      requestQueueSync();
      return null;
    }

    return syncAllToCloud(userId);
  }

  async function handleRestore() {
    if (!uid) return;
    setRestoring(true);
    setRestoreError("");
    try {
      await restoreFromCloud(uid, setRestoreStep);
      setRestoreSkipped(false);
      clearSkippedRestore(uid);
      setRestoreStep("Preparing app reload…");
      await clearAppCaches();
      // Close DB before reload to guarantee IDB writes are flushed (important on Safari/iOS).
      try {
        db.close();
      } catch {
        /* non-fatal */
      }
      window.location.replace(window.location.pathname || "/");
    } catch (e) {
      console.error("[restore]", e);
      setRestoreError(getRestoreErrorMessage(e));
      setRestoring(false);
    }
  }

  function handleSkipRestore() {
    if (uid) rememberSkippedRestore(uid, cloudMeta);
    setRestoreSkipped(true);
    setCloudMeta(null);
    setRestoreChecked(true);
  }

  // Reconnect handler + daily auto-sync (only after restore decision)
  useEffect(() => {
    if (!uid || !restoreChecked || restoreSkipped) return;

    const pullLatestSettings = async () => {
      const pulled = await pullSettingsFromCloud(uid);
      if (pulled) setSettings(pulled);
    };

    const handleOnline = () => {
      // Reconnect must drain the durable offline queue first. A full backup here
      // can turn a normal offline bill into product/settings conflicts.
      requestQueueSync();
    };
    window.addEventListener("online", handleOnline);

    // Daily auto-sync: run if last sync was >24 h ago (or never)
    if (navigator.onLine) {
      let needsSync = true;
      try {
        const stored = localStorage.getItem(`shopkeeper_last_sync_${uid}`);
        if (stored) {
          const meta = JSON.parse(stored) as SyncMeta;
          needsSync =
            Date.now() - new Date(meta.lastSyncedAt).getTime() > 86_400_000;
        }
      } catch {
        /* proceed */
      }
      if (needsSync) void runSafeFullSync(uid);
      requestQueueSync();
      void pullLatestSettings();
    }

    return () => window.removeEventListener("online", handleOnline);
  }, [uid, restoreChecked, restoreSkipped, setSettings]);

  return (
    <>
      <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr] bg-slate-50">
        {/* Skip-to-content: visually hidden until focused by keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-brand focus:text-white focus:rounded-xl focus:font-medium focus:text-sm"
        >
          {t("nav.skipToContent")}
        </a>

        <aside className="bg-slate-900 text-white flex flex-col lg:min-h-screen lg:sticky lg:top-0">
          {/* Desktop: logo at top of the sidebar */}
          <div className="hidden lg:block px-5 pt-6 pb-4">
            <AppSidebarBrand />
          </div>

          {/* Mobile: compact header bar — store name, sync pill, sign-out */}
          <div className="flex lg:hidden items-center gap-2 px-4 py-3 border-b border-white/10">
            <span className="font-bold text-sm tracking-tight truncate">
              Shopkeeper POS
            </span>
            <div className="ms-auto flex items-center gap-2 shrink-0">
              <SyncStatusBadge compact />
              <SafeSignOutButton className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors" />
            </div>
          </div>

          {/* Desktop-only nav — MobileBottomNav handles mobile routing */}
          <SidebarNav />

          {/* Desktop: user info + sync badge at the foot of the sidebar */}
          <div className="hidden lg:block px-4 pb-5 mt-auto">
            <div className="text-xs text-slate-400 mb-1 truncate">
              {user?.name}
            </div>
            <div className="text-xs text-slate-500 mb-3 truncate">
              {user?.email}
            </div>
            <SyncStatusBadge />
            <SafeSignOutButton className="w-full text-start text-xs text-slate-400 hover:text-white transition-colors" />
          </div>
        </aside>

        {/*
          pb-24 on mobile keeps content above the fixed bottom nav.
          lg:pb-6 reverts to normal desktop padding once the sidebar takes over.
        */}
        <main id="main-content" className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
          <DbBootstrap>
            <ConflictResolverModal userId={uid} />
            {cloudMeta && (
              <RestoreModal
                meta={cloudMeta}
                restoring={restoring}
                step={restoreStep}
                error={restoreError}
                onRestore={handleRestore}
                onSkip={handleSkipRestore}
              />
            )}
            {children}
          </DbBootstrap>
        </main>
      </div>

      {/* Fixed mobile bottom navigation — hidden on desktop */}
      <MobileBottomNav />
    </>
  );
}

// ─── Restore modal ────────────────────────────────────────────────────────────

function RestoreModal({
  meta,
  restoring,
  step,
  error,
  onRestore,
  onSkip,
}: {
  meta: SyncMeta;
  restoring: boolean;
  step: string;
  error: string;
  onRestore: () => void;
  onSkip: () => void;
}) {
  const { t } = useLocale();
  const uid = useId();
  const titleId = `restore-title-${uid}`;
  const { bills, products, stockMovements } = meta.recordCounts;
  const date = new Date(meta.lastSyncedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl p-6"
      >
        <button
          type="button"
          aria-label={t("auth.closeRestorePrompt")}
          onClick={onSkip}
          disabled={restoring}
          className="absolute end-3 top-3 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
        {/* Icon */}
        <div className="w-12 h-12 bg-brand-soft rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-brand"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
            />
          </svg>
        </div>

        <h2 id={titleId} className="text-base font-bold text-slate-800 text-center mb-1">
          {t("auth.useExistingTitle")}
        </h2>
        <p className="text-sm text-slate-500 text-center mb-4">
          {t("auth.useExistingDesc", { date })}
        </p>

        {/* Counts */}
        <div className="flex justify-center gap-4 mb-5">
          <Stat value={bills} label={t("auth.restoreStatBills")} />
          <Stat value={products} label={t("auth.restoreStatProducts")} />
          <Stat value={stockMovements} label={t("auth.restoreStatMovements")} />
        </div>

        {/* Progress / error */}
        {restoring && step && (
          <p className="text-xs text-info text-center mb-3 animate-pulse">
            {step}
          </p>
        )}
        {error && (
          <div className="text-xs text-danger bg-danger-soft border border-danger/20 rounded-xl px-3 py-2 mb-3 text-center">
            <p className="select-text">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(error);
                }
              }}
              className="mt-2 font-medium text-danger underline underline-offset-2"
            >
              {t("auth.copyError")}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onRestore}
            disabled={restoring}
            className="w-full py-2.5 bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {restoring ? t("auth.syncing") : t("auth.syncCloudData")}
          </button>
          <button
            onClick={onSkip}
            disabled={restoring}
            className="w-full py-2 text-slate-500 hover:text-slate-700 text-sm transition-colors disabled:opacity-40"
          >
            {t("auth.startEmpty")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-slate-800 tabular-nums">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

// ─── Loading / gate screens ───────────────────────────────────────────────────

function LoadingScreen() {
  const { t } = useLocale();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">{t("auth.appLoading")}</p>
      </div>
    </div>
  );
}

function PendingScreen({ onLogout }: { onLogout: () => void }) {
  const { refreshStatus } = useAuth();
  const { t } = useLocale();
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  async function handleCheck() {
    setChecking(true);
    setChecked(false);
    await refreshStatus();
    // If still pending after refresh, show "still waiting" feedback
    setChecked(true);
    setChecking(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 bg-warning-soft rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-warning"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">{t("auth.pendingTitle")}</h2>
        <p className="text-sm text-slate-500 mb-2">{t("auth.pendingDesc")}</p>
        <p className="text-xs text-slate-400 mb-6">{t("auth.pendingContactAdmin")}</p>
        {checked && (
          <p className="text-xs text-warning bg-warning-soft border border-warning/30 rounded-xl px-3 py-2 mb-4">
            {t("auth.pendingStillWaiting")}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-2.5 px-4 bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {checking ? t("auth.checking") : t("auth.checkApproval")}
          </button>
          <button
            onClick={onLogout}
            className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            {t("auth.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}

function InactiveScreen({ onLogout }: { onLogout: () => void }) {
  const { refreshStatus } = useAuth();
  const { t } = useLocale();
  const [checking, setChecking] = useState(false);

  async function handleCheck() {
    setChecking(true);
    await refreshStatus();
    setChecking(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 bg-danger-soft rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-danger"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">{t("auth.inactiveTitle")}</h2>
        <p className="text-sm text-slate-500 mb-6">{t("auth.inactiveDesc")}</p>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-2.5 px-4 bg-brand hover:bg-brand-hover disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {checking ? t("auth.checking") : t("auth.checkStatus")}
          </button>
          <button
            onClick={onLogout}
            className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            {t("auth.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Auth screens ─────────────────────────────────────────────────────────────

function AuthScreen() {
  const [view, setView] = useState<"login" | "signup">("login");
  if (view === "signup") return <SignUpForm onBack={() => setView("login")} />;
  return <LoginForm onShowSignUp={() => setView("signup")} />;
}

function LoginForm({ onShowSignUp }: { onShowSignUp: () => void }) {
  const { authError } = useAuth();
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (
        code === "auth/invalid-credential" ||
        code === "auth/user-not-found" ||
        code === "auth/wrong-password"
      ) {
        setError(t("auth.invalidCredentials"));
      } else if (code === "auth/too-many-requests") {
        setError(t("auth.tooManyAttempts"));
      } else if (code === "auth/network-request-failed") {
        setError(t("auth.noInternetLogin"));
      } else {
        setError(t("auth.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full">
        <AppLogo />
        <Card padding="lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t("auth.email")}>
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </FormField>
            <FormField label={t("auth.password")}>
              <Input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </FormField>
            {(error || authError) && <ErrorBox message={error || authError} />}
            <Button type="submit" loading={loading} fullWidth>
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>
        </Card>
        <p className="text-center text-sm text-slate-500 mt-5">
          {t("auth.dontHaveAccount")}{" "}
          <button
            onClick={onShowSignUp}
            className="text-info hover:underline font-medium"
          >
            {t("auth.requestAccess")}
          </button>
        </p>
      </div>
    </div>
  );
}

function SignUpForm({ onBack }: { onBack: () => void }) {
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await registerUser(email, password, name, phone || undefined);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use") {
        setError(t("auth.emailInUse"));
      } else if (code === "auth/weak-password") {
        setError(t("auth.weakPassword"));
      } else if (code === "auth/network-request-failed") {
        setError(t("auth.noInternetRegister"));
      } else {
        setError(t("auth.registrationFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full">
        <AppLogo subtitle={t("auth.requestAccess")} />
        <Card padding="lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t("auth.fullName")}>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
              />
            </FormField>
            <FormField label={t("auth.email")}>
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </FormField>
            <FormField
              label={
                <span>
                  {t("auth.phone")}{" "}
                  <span className="font-normal text-slate-400">{t("auth.phoneOptional")}</span>
                </span>
              }
            >
              <Input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 0123"
              />
            </FormField>
            <FormField label={t("auth.password")}>
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordMinLength")}
              />
            </FormField>
            <FormField label={t("auth.confirmPassword")}>
              <Input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </FormField>
            {error && <ErrorBox message={error} />}
            <Button type="submit" loading={loading} fullWidth>
              {loading ? t("auth.sendingRequest") : t("auth.requestAccess")}
            </Button>
          </form>
        </Card>
        <p className="text-center text-sm text-slate-500 mt-5">
          {t("auth.alreadyHaveAccount")}{" "}
          <button
            onClick={onBack}
            className="text-info hover:underline font-medium"
          >
            {t("auth.signIn")}
          </button>
        </p>
      </div>
    </div>
  );
}

function AppLogo({ subtitle }: { subtitle?: string }) {
  const { t } = useLocale();
  return (
    <div className="text-center mb-8">
      <div className="w-12 h-12 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4">
        <svg
          className="w-7 h-7 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
          />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-slate-800">Shopkeeper POS</h1>
      <p className="text-sm text-slate-500 mt-1">{subtitle ?? t("auth.signInToContinue")}</p>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert">
      <Badge
        tone="danger"
        className="whitespace-normal rounded-xl px-3 py-2 text-sm"
      >
        {message}
      </Badge>
    </div>
  );
}

function SafeSignOutButton({ className }: { className?: string }) {
  const { user, logout } = useAuth();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof getLocalDataSummary>
  > | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function openModal() {
    setSummary(await getLocalDataSummary());
    setOpen(true);
  }
  async function signOutKeepingDeviceData() {
    setSigningOut(true);
    try {
      if (user?.uid) {
        await saveCurrentAccountSnapshot(user.uid);
        // Stamp the UID so runRestoreCheck can wipe local Dexie if a different
        // account signs in on the same device next time.
        try { localStorage.setItem('shopkeeper_last_active_uid', user.uid); } catch { /* non-fatal */ }
      }
      await logout();
    } finally {
      setSigningOut(false);
    }
  }
  async function syncThenSignOut() {
    if (!user?.uid) return signOutKeepingDeviceData();
    setSyncing(true);
    const result = await syncAllToCloud(user.uid);
    setSyncing(false);
    if (!result) {
      setSummary(await getLocalDataSummary());
      return;
    }
    await signOutKeepingDeviceData();
  }

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const hasUnsynced = Boolean(summary?.hasUnsyncedWork);
  // Include blocked (Sprint A) so the sign-out modal accurately shows how
  // much work hasn't yet reached the cloud. Conflicts have their own dedicated
  // banner below so they aren't double-counted here.
  const pendingCount = summary
    ? summary.pending + summary.failed + summary.syncing + summary.blocked
    : 0;
  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={className ?? "text-sm text-slate-500 hover:text-slate-700"}
      >
        {t("auth.signOut")}
      </button>
      <Modal
        open={open}
        title={
          isOffline
            ? t("auth.offlineTitle")
            : hasUnsynced
              ? t("auth.unsyncedTitle")
              : t("auth.signOutTitle")
        }
        description={
          isOffline
            ? t("auth.offlineDesc")
            : hasUnsynced
              ? t("auth.unsyncedDesc")
              : t("auth.signOutDesc")
        }
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={signingOut || syncing}
            >
              {t("common.cancel")}
            </Button>
            {!isOffline && hasUnsynced && (
              <Button
                type="button"
                onClick={syncThenSignOut}
                disabled={signingOut || syncing}
              >
                {syncing ? t("auth.syncing") : t("auth.syncThenSignOut")}
              </Button>
            )}
            <Button
              type="button"
              variant={hasUnsynced || isOffline ? "danger" : "primary"}
              onClick={signOutKeepingDeviceData}
              disabled={signingOut || syncing}
            >
              {signingOut
                ? t("auth.signingOut")
                : hasUnsynced || isOffline
                  ? t("auth.signOutAnyway")
                  : t("auth.signOut")}
            </Button>
          </>
        }
      >
        {summary && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>{t("auth.signOutDataNote")}</p>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs">
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.products}
                </span>{" "}
                {t("auth.signOutStatProducts")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.bills}
                </span>{" "}
                {t("auth.signOutStatBills")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.customers}
                </span>{" "}
                {t("auth.signOutStatCustomers")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.suppliers}
                </span>{" "}
                {t("auth.signOutStatSuppliers")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.purchases}
                </span>{" "}
                {t("auth.signOutStatPurchases")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.shifts}
                </span>{" "}
                {t("auth.signOutStatShifts")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.stockMovements}
                </span>{" "}
                {t("auth.signOutStatMovements")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.customerPayments}
                </span>{" "}
                {t("auth.signOutStatPayments")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.supplierPayments}
                </span>{" "}
                {t("auth.signOutStatSupplierPayments")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {pendingCount}
                </span>{" "}
                {t("auth.signOutStatPending")}
              </div>
              <div>
                <span className="font-semibold text-slate-800">
                  {summary.conflicts}
                </span>{" "}
                {t("auth.signOutStatConflicts")}
              </div>
            </div>
            {summary.conflicts > 0 && (
              <p className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-warning">
                {t("auth.signOutConflictsWarning")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
