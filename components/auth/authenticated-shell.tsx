"use client";

import { useState, useEffect, useId, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, usePathname } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/components/providers/auth-context";
import { useLocale } from "@/components/providers/locale-context";
import { signIn, registerUser } from "@/lib/firebase/auth-service";
import {
  getSubscriptionAccessState,
  subscriptionExpiryDateLabel,
} from "@/lib/services/subscription-service";
import { syncAllToCloud, type SyncMeta } from "@/lib/firebase/sync-service";
import { getPendingSyncCount } from "@/lib/services/sync-queue-service";
import { getOpenConflicts } from "@/lib/services/sync-conflict-service";
import {
  restoreFromCloud,
  pullSettingsFromCloud,
  getRestoreErrorMessage,
} from "@/lib/firebase/restore-service";
import { classifySyncStartupState } from "@/lib/services/sync-startup-decision-service";
import { db } from "@/lib/db/schema";
import { DbBootstrap } from "@/components/providers/db-bootstrap";
import { AppSidebarBrand } from "@/components/app-sidebar-brand";
import { SidebarNav } from "@/components/sidebar-nav";
import { useSettings } from "@/components/providers/settings-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { setRestoreDecisionPending } from "@/lib/services/sync-gate";
import { SyncStatusBadge } from "@/components/sync/sync-status-badge";
import { SafeSignOutButton } from "@/components/auth/safe-sign-out-button";
import { ConflictResolverModal } from "@/components/sync/conflict-resolver-modal";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PublicShell } from "@/components/auth/public-shell";
import {
  lockBodyScroll,
  resetBodyScrollLock,
  resetBodyScrollLockIfStale,
} from "@/lib/utils/body-scroll-lock";

// Routes reachable WITHOUT authentication. Prefix-matched, allowlist-only: only
// these paths bypass the auth gate; every other route keeps its existing
// behaviour. Public pages render in PublicShell (no DB, no sync).
const PUBLIC_PATHS = ["/guide"] as const;
const E2E_AUTH_ENABLED = process.env.NEXT_PUBLIC_E2E_AUTH === "1";

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

export function AuthenticatedShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status, user, logout } = useAuth();
  const pathname = usePathname();

  useEffect(() => {
    resetBodyScrollLock();
  }, [pathname]);

  // UI safety guard: if any modal/sheet leaves the document locked after it
  // closes, restore scroll immediately. This protects checkout pages where
  // reaching the finalize buttons is business-critical on laptop touchpads and
  // mobile browsers.
  useEffect(() => {
    resetBodyScrollLockIfStale();

    const handleUserScrollAttempt = () => {
      resetBodyScrollLockIfStale();
    };

    const observer = new MutationObserver(() => {
      resetBodyScrollLockIfStale();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-modal",
        "aria-hidden",
        "class",
        "hidden",
        "style",
      ],
    });

    window.addEventListener("wheel", handleUserScrollAttempt, {
      capture: true,
      passive: true,
    });
    window.addEventListener("touchstart", handleUserScrollAttempt, {
      capture: true,
      passive: true,
    });

    const interval = window.setInterval(resetBodyScrollLockIfStale, 1000);

    return () => {
      observer.disconnect();
      window.removeEventListener("wheel", handleUserScrollAttempt, true);
      window.removeEventListener("touchstart", handleUserScrollAttempt, true);
      window.clearInterval(interval);
    };
  }, []);

  // Public allowlist takes precedence over the auth gate so /guide is reachable
  // when logged out. Checked before status so it never flashes the login screen.
  if (isPublicPath(pathname)) return <PublicShell>{children}</PublicShell>;

  if (status === "loading") return <LoadingScreen />;
  if (status === "unauthenticated") return <AuthScreen />;
  if (status === "pending") return <PendingScreen onLogout={logout} />;
  if (status === "inactive") return <InactiveScreen onLogout={logout} />;
  if (status === "subscription_expired")
    return <SubscriptionExpiredScreen onLogout={logout} />;

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
    <div className="min-h-dvh bg-slate-50 lg:ps-[260px]">
      {/* Skip-to-content: visually hidden until focused by keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-brand focus:text-white focus:rounded-xl focus:font-medium focus:text-sm"
      >
        {t("nav.skipToContent")}
      </a>

      <aside className="bg-slate-900 text-white flex flex-col lg:fixed lg:inset-y-0 lg:start-0 lg:z-40 lg:h-dvh lg:w-[260px] lg:min-h-0 lg:overflow-hidden">
        <div className="hidden lg:block px-5 pt-6 pb-4">
          <AppSidebarBrand />
        </div>
        <div className="flex lg:hidden items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="font-bold text-base tracking-tight">Asas POS</span>
          <span className="text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
            Admin
          </span>
          <SafeSignOutButton className="ms-auto rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors" />
        </div>

        <nav
          aria-label={t("nav.adminNavLabel")}
          className="flex flex-row overflow-x-auto gap-1 px-3 py-2 lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
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

        <div className="hidden lg:block shrink-0 border-t border-white/10 px-4 py-5">
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

      <main
        id="main-content"
        className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6"
      >
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
  const { settings, setSettings } = useSettings();
  const uid = user?.uid;

  // Restore flow state
  const [cloudMeta, setCloudMeta] = useState<SyncMeta | null>(null);
  const [restoreChecked, setRestoreChecked] = useState(E2E_AUTH_ENABLED);
  const [restoreSkipped, setRestoreSkipped] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreStep, setRestoreStep] = useState("");
  const [restoreError, setRestoreError] = useState("");
  // Fresh-device cloud data is restored silently (no choice prompt). The modal
  // only appears as a fallback if that silent restore fails.
  const [autoRestoring, setAutoRestoring] = useState(false);
  const checkRan = useRef<string | null>(null);

  // One-time new-device detection per uid (resets if uid ever changes).
  // While the check runs, we close the sync-gate so background runSync ticks
  // don't pull cloud rows into a still-being-decided local DB. The gate
  // reopens in every branch of runRestoreCheck (success, skip, no-meta, or
  // error) via the finally.
  useEffect(() => {
    if (E2E_AUTH_ENABLED || !uid || checkRan.current === uid) return;
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
        const lastUid = localStorage.getItem("shopkeeper_last_active_uid");
        if (lastUid && lastUid !== userId) {
          await db.transaction("rw", db.tables, async () => {
            await Promise.all(db.tables.map((t) => t.clear()));
          });
          localStorage.setItem("shopkeeper_last_active_uid", userId);
        }
      } catch {
        // Non-fatal — if the wipe fails, proceed with whatever is in IndexedDB.
      }

      // Single source of truth for the startup decision. The classifier reads
      // cheap local counts + the cloud meta/sync doc and returns one clear
      // verdict (plus a reason). We surface it as an event so support tooling
      // can read exactly why a screen did or didn't appear.
      const decision = await classifySyncStartupState({ uid: userId });
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("shopkeeper:sync-startup-decision", { detail: decision }),
        );
      }

      // Only a truly empty device with cloud data restores here. Every other
      // verdict (silent pull/push, auto-merge, true conflict) is handled by the
      // background SyncProvider / ConflictResolverModal — never a choice prompt.
      if (decision.decision === "RESTORE_CLOUD_SILENTLY") {
        const meta: SyncMeta = {
          lastSyncedAt:
            decision.cloudSummary.lastCloudChangeAt ?? new Date().toISOString(),
          // RestoreModal reads each count defensively (?? 0); the classifier's
          // entityCounts is the same shape as SyncMeta.recordCounts.
          recordCounts: (decision.cloudSummary.entityCounts ??
            {}) as SyncMeta["recordCounts"],
        };
        const skippedBackup = readSkippedRestoreMeta(userId);
        if (skippedBackup === meta.lastSyncedAt) {
          setRestoreSkipped(true);
          setRestoreChecked(true);
          return;
        }
        // No real conflict — restore silently behind a loading screen. Keep
        // `cloudMeta` so the manual modal can take over if the silent restore
        // fails. Awaited here so the sync gate (closed by the caller) stays shut
        // for the whole fetch+clear+write sequence.
        setCloudMeta(meta);
        setAutoRestoring(true);
        await runSilentRestore(userId);
        return;
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

  // Silent fresh-device restore. On success the page reloads into a populated
  // local DB; on failure we drop the auto flag so the manual RestoreModal
  // renders with the error and the user can retry or start empty. restoreFromCloud
  // only clears local data inside a transaction that rolls back on failure, so a
  // mid-restore network error never leaves local half-deleted.
  async function runSilentRestore(userId: string) {
    try {
      await restoreFromCloud(userId, setRestoreStep);
      clearSkippedRestore(userId);
      await clearAppCaches();
      try {
        db.close();
      } catch {
        /* non-fatal */
      }
      window.location.replace(window.location.pathname || "/");
    } catch (e) {
      console.error("[restore:auto]", e);
      setRestoreError(getRestoreErrorMessage(e));
      setAutoRestoring(false);
    }
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
    if (E2E_AUTH_ENABLED || !uid || !restoreChecked || restoreSkipped) return;

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
      <div className="min-h-dvh bg-slate-50 lg:ps-[260px]">
        {/* Skip-to-content: visually hidden until focused by keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:start-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-brand focus:text-white focus:rounded-xl focus:font-medium focus:text-sm"
        >
          {t("nav.skipToContent")}
        </a>

        <aside className="bg-slate-900 text-white flex flex-col lg:fixed lg:inset-y-0 lg:start-0 lg:z-40 lg:h-dvh lg:w-[260px] lg:min-h-0 lg:overflow-hidden">
          {/* Desktop: logo at top of the sidebar */}
          <div className="hidden lg:block px-5 pt-6 pb-4">
            <AppSidebarBrand />
          </div>

          {/* Mobile: compact header bar — store name + sync state only. Sign-out
              lives in the More → Account section (it is risky offline and not a
              frequent cashier action, so it shouldn't sit in the working header). */}
          <div className="flex lg:hidden items-center gap-2 px-4 py-3 border-b border-white/10">
            {/* Store name gives the cashier working context; falls back to the
                product brand only until settings load. */}
            <span className="font-bold text-sm tracking-tight truncate">
              {settings?.storeName?.trim() || "Asas POS"}
            </span>
            <div className="ms-auto flex items-center gap-2 shrink-0">
              <SyncStatusBadge compact />
            </div>
          </div>

          {/* Desktop-only nav — MobileBottomNav handles mobile routing */}
          <SidebarNav />

          {/* Desktop: user info + sync badge at the foot of the sidebar */}
          <div className="hidden lg:block shrink-0 border-t border-white/10 px-4 py-5">
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
        <main
          id="main-content"
          className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6"
        >
          <DbBootstrap>
            <ConflictResolverModal userId={uid} />
            {cloudMeta && autoRestoring && (
              <PreparingDataScreen step={restoreStep} />
            )}
            {cloudMeta && !autoRestoring && (
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
  const counts = meta.recordCounts;
  const restoreStats = [
    { value: counts.bills ?? 0, label: t("auth.restoreStatBills") },
    { value: counts.products ?? 0, label: t("auth.restoreStatProducts") },
    { value: counts.purchases ?? 0, label: t("auth.restoreStatPurchases") },
    {
      value: (counts.customers ?? 0) + (counts.customerPayments ?? 0),
      label: t("auth.restoreStatCustomers"),
    },
    {
      value: (counts.suppliers ?? 0) + (counts.supplierPayments ?? 0),
      label: t("auth.restoreStatSuppliers"),
    },
    {
      value: (counts.cashMovements ?? 0) + (counts.expenses ?? 0),
      label: t("auth.restoreStatPayments"),
    },
    {
      value: counts.stockMovements ?? 0,
      label: t("auth.restoreStatMovements"),
    },
  ].filter((stat) => stat.value > 0);
  const date = new Date(meta.lastSyncedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  useEffect(() => lockBodyScroll(), []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 backdrop-blur-sm"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
      >
        <button
          type="button"
          aria-label={t("auth.closeRestorePrompt")}
          onClick={onSkip}
          disabled={restoring}
          className="absolute end-3 top-3 rounded-full bg-danger-soft/50 p-2 text-danger/75 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-40"
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

        <h2
          id={titleId}
          className="text-base font-bold text-slate-800 text-center mb-1"
        >
          {t("auth.useExistingTitle")}
        </h2>
        <p className="text-sm text-slate-500 text-center mb-4">
          {t("auth.useExistingDesc", { date })}
        </p>

        {/* Counts */}
        <div className="grid grid-cols-2 gap-2 mb-5 sm:grid-cols-3">
          {restoreStats.map((stat) => (
            <Stat key={stat.label} value={stat.value} label={stat.label} />
          ))}
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
    <div className="min-h-dvh flex items-center justify-center bg-slate-50">
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">{t("auth.appLoading")}</p>
      </div>
    </div>
  );
}

// Full-screen loader shown while a fresh device silently restores cloud data.
// Replaces the old "Use cloud data? / Start empty" prompt for the no-conflict
// fresh-device case. The `step` text comes from restoreFromCloud's progress.
function PreparingDataScreen({ step }: { step: string }) {
  const { t } = useLocale();
  useEffect(() => lockBodyScroll(), []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 px-4"
      role="status"
      aria-live="polite"
    >
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm font-medium text-slate-700">
          {t("auth.preparingStoreData")}
        </p>
        {step && (
          <p className="mt-1 text-xs text-info animate-pulse">{step}</p>
        )}
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
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
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
        <h2 className="font-semibold text-slate-800 mb-2">
          {t("auth.pendingTitle")}
        </h2>
        <p className="text-sm text-slate-500 mb-2">{t("auth.pendingDesc")}</p>
        <p className="text-xs text-slate-400 mb-6">
          {t("auth.pendingContactAdmin")}
        </p>
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
          <Link
            href={"/guide" as Route}
            className="w-full text-center text-sm text-info hover:underline font-medium pt-1"
          >
            {t("guide.common.learnHow")}
          </Link>
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
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
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
        <h2 className="font-semibold text-slate-800 mb-2">
          {t("auth.inactiveTitle")}
        </h2>
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
          <Link
            href={"/guide" as Route}
            className="w-full text-center text-sm text-info hover:underline font-medium pt-1"
          >
            {t("guide.common.learnHow")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function SubscriptionExpiredScreen({ onLogout }: { onLogout: () => void }) {
  const { user, refreshStatus } = useAuth();
  const { t } = useLocale();
  const [checking, setChecking] = useState(false);
  const state = getSubscriptionAccessState(user);
  const isSuspended = state === "suspended";

  async function handleCheck() {
    setChecking(true);
    await refreshStatus();
    setChecking(false);
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-warning/20 p-8 text-center">
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
              d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.5-1.67 1.73-3L13.73 4c-.77-1.33-2.69-1.33-3.46 0L3.2 16c-.77 1.33.19 3 1.73 3z"
            />
          </svg>
        </div>
        <h2 className="font-semibold text-slate-800 mb-2">
          {isSuspended
            ? t("auth.subscriptionSuspendedTitle")
            : t("auth.subscriptionExpiredTitle")}
        </h2>
        <p className="text-sm text-slate-500 mb-2">
          {isSuspended
            ? t("auth.subscriptionSuspendedDesc")
            : t("auth.subscriptionExpiredDesc")}
        </p>
        {user?.subscriptionEndAt && !isSuspended && (
          <p className="text-xs text-slate-400 mb-5">
            {t("auth.subscriptionExpiredOn", {
              date: subscriptionExpiryDateLabel(user),
            })}
          </p>
        )}
        <div className="rounded-xl bg-warning-soft border border-warning/20 px-3 py-2 text-xs text-warning mb-5">
          {t("auth.subscriptionReadOnlyNote")}
        </div>
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
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
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
                placeholder={t("auth.emailPlaceholder")}
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
            {t("auth.startTrial")}
          </button>
        </p>
        <p className="text-center text-sm text-slate-500 mt-2">
          <Link
            href={"/guide" as Route}
            className="text-info hover:underline font-medium"
          >
            {t("guide.common.learnHow")}
          </Link>
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
    <div className="min-h-dvh flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full">
        <AppLogo subtitle={t("auth.startTrial")} />
        <Card padding="lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label={t("auth.fullName")}>
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("auth.namePlaceholder")}
              />
            </FormField>
            <FormField label={t("auth.email")}>
              <Input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
              />
            </FormField>
            <FormField
              label={
                <span>
                  {t("auth.phone")}{" "}
                  <span className="font-normal text-slate-400">
                    {t("auth.phoneOptional")}
                  </span>
                </span>
              }
            >
              <Input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t("auth.phonePlaceholder")}
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
              {loading ? t("auth.creatingTrial") : t("auth.createTrial")}
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
        <p className="text-center text-sm text-slate-500 mt-2">
          <Link
            href={"/guide" as Route}
            className="text-info hover:underline font-medium"
          >
            {t("guide.common.learnHow")}
          </Link>
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
      <h1 className="text-xl font-bold text-slate-800">Asas POS</h1>
      <p className="text-sm text-slate-500 mt-1">
        {subtitle ?? t("auth.signInToContinue")}
      </p>
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
