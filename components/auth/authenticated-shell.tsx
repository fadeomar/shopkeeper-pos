"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, usePathname } from "next/navigation";
import clsx from "clsx";
import { useAuth } from "@/components/providers/auth-context";
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
import { getLocalDataSummary, saveCurrentAccountSnapshot } from "@/lib/services/account-data-service";
import { SyncStatusBadge } from "@/components/sync/sync-status-badge";
import { ConflictResolverModal } from "@/components/sync/conflict-resolver-modal";

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
  if (user?.role === "admin") return <AdminShell>{children}</AdminShell>;
  return <CashierShell>{children}</CashierShell>;
}

// ─── Admin shell ─────────────────────────────────────────────────────────────
// No DbBootstrap — admin reads only from Firestore, never from local IndexedDB.
// Auto-redirects to /admin/users if landed on a POS route.

function AdminShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
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

        <nav className="flex flex-row overflow-x-auto gap-1 px-3 py-2 lg:flex-col lg:overflow-x-visible lg:flex-1">
          <Link
            href={"/admin/users" as Route}
            className={clsx(
              "whitespace-nowrap px-3 py-2 rounded-xl text-sm font-medium transition-colors lg:w-full",
              pathname.startsWith("/admin")
                ? "bg-blue-600 text-white"
                : "text-slate-300 hover:bg-white/10 hover:text-white",
            )}
          >
            Users
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

      <main className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">{children}</main>
    </div>
  );
}

// ─── Cashier shell ────────────────────────────────────────────────────────────
// Full POS shell with local IndexedDB (DbBootstrap), reconnect sync,
// daily auto-sync, and new-device cloud restore detection.

function CashierShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
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

  // One-time new-device detection per uid (resets if uid ever changes)
  useEffect(() => {
    if (!uid || checkRan.current === uid) return;
    checkRan.current = uid;
    void runRestoreCheck(uid);
  }, [uid]);

  async function runRestoreCheck(userId: string) {
    try {
      const empty = await isLocalDbEmpty();
      if (empty) {
        const meta = await fetchSyncMeta(userId);
        if (
          meta &&
          (meta.recordCounts.bills > 0 || meta.recordCounts.products > 0)
        ) {
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
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-[260px_1fr] bg-slate-50">
      <aside className="bg-slate-900 text-white flex flex-col lg:min-h-screen lg:sticky lg:top-0">
        <div className="hidden lg:block px-5 pt-6 pb-4">
          <AppSidebarBrand />
        </div>
        <div className="flex lg:hidden items-center gap-3 px-4 py-3 border-b border-white/10">
          <span className="font-bold text-base tracking-tight">
            Shopkeeper POS
          </span>
          <div className="ms-auto flex items-center gap-2">
            <div className="hidden sm:block max-w-[220px]">
              <SyncStatusBadge compact />
            </div>
            <SafeSignOutButton className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition-colors" />
          </div>
        </div>
        <SidebarNav />
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
      <main className="min-w-0 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-6 lg:pb-6">
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
  const { bills, products, stockMovements } = meta.recordCounts;
  const date = new Date(meta.lastSyncedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl p-6">
        <button
          type="button"
          aria-label="Close restore prompt"
          onClick={onSkip}
          disabled={restoring}
          className="absolute end-3 top-3 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
        {/* Icon */}
        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-blue-600"
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

        <h2 className="text-base font-bold text-slate-800 text-center mb-1">
          Use your existing data?
        </h2>
        <p className="text-sm text-slate-500 text-center mb-4">
          We found data for this account in the cloud from{" "}
          <span className="font-medium text-slate-700">{date}</span>. Sync it to this device, or start with an empty local workspace. Starting empty will not delete your cloud data.
        </p>

        {/* Counts */}
        <div className="flex justify-center gap-4 mb-5">
          <Stat value={bills} label="bills" />
          <Stat value={products} label="products" />
          <Stat value={stockMovements} label="movements" />
        </div>

        {/* Progress / error */}
        {restoring && step && (
          <p className="text-xs text-blue-600 text-center mb-3 animate-pulse">
            {step}
          </p>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-3 text-center">
            <p className="select-text">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(error);
                }
              }}
              className="mt-2 font-medium text-red-700 underline underline-offset-2"
            >
              Copy error
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onRestore}
            disabled={restoring}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {restoring ? "Syncing…" : "Sync cloud data"}
          </button>
          <button
            onClick={onSkip}
            disabled={restoring}
            className="w-full py-2 text-slate-500 hover:text-slate-700 text-sm transition-colors disabled:opacity-40"
          >
            Start empty on this device
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
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="p-8 bg-white rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm text-slate-500">Loading Shopkeeper POS…</p>
      </div>
    </div>
  );
}

function PendingScreen({ onLogout }: { onLogout: () => void }) {
  const { refreshStatus } = useAuth();
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
        <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-amber-600"
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
        <h2 className="font-semibold text-slate-800 mb-2">Awaiting Approval</h2>
        <p className="text-sm text-slate-500 mb-2">
          Your account request was received. An admin must approve it before you
          can access the app.
        </p>
        <p className="text-xs text-slate-400 mb-6">
          Contact your admin if this takes too long.
        </p>
        {checked && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-4">
            Still waiting — your admin hasn&apos;t approved yet.
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {checking ? "Checking…" : "Check approval status"}
          </button>
          <button
            onClick={onLogout}
            className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function InactiveScreen({ onLogout }: { onLogout: () => void }) {
  const { refreshStatus } = useAuth();
  const [checking, setChecking] = useState(false);

  async function handleCheck() {
    setChecking(true);
    await refreshStatus();
    setChecking(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg
            className="w-6 h-6 text-red-600"
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
        <h2 className="font-semibold text-slate-800 mb-2">Account Disabled</h2>
        <p className="text-sm text-slate-500 mb-6">
          Your account has been deactivated. Contact your admin to restore
          access.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={handleCheck}
            disabled={checking}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {checking ? "Checking…" : "Check account status"}
          </button>
          <button
            onClick={onLogout}
            className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium rounded-xl transition-colors"
          >
            Sign out
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
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Try again later.");
      } else if (code === "auth/network-request-failed") {
        setError("No internet. You must be online for first login.");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full">
        <AppLogo />
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            {(error || authError) && <ErrorBox message={error || authError} />}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-slate-500 mt-5">
          No account?{" "}
          <button
            onClick={onShowSignUp}
            className="text-blue-600 hover:underline font-medium"
          >
            Request access
          </button>
        </p>
      </div>
    </div>
  );
}

function SignUpForm({ onBack }: { onBack: () => void }) {
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
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await registerUser(email, password, name, phone || undefined);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/email-already-in-use") {
        setError("An account with this email already exists.");
      } else if (code === "auth/weak-password") {
        setError("Password must be at least 6 characters.");
      } else if (code === "auth/network-request-failed") {
        setError("No internet. You need to be online to register.");
      } else {
        setError("Registration failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm w-full">
        <AppLogo subtitle="Request access" />
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Full name
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Jane Smith"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Phone{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="+1 555 0123"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Min 6 characters"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Confirm password
              </label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            {error && <ErrorBox message={error} />}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {loading ? "Sending request…" : "Request access"}
            </button>
          </form>
        </div>
        <p className="text-center text-sm text-slate-500 mt-5">
          Already have an account?{" "}
          <button
            onClick={onBack}
            className="text-blue-600 hover:underline font-medium"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}

function AppLogo({ subtitle = "Sign in to continue" }: { subtitle?: string }) {
  return (
    <div className="text-center mb-8">
      <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
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
      <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
      {message}
    </p>
  );
}


function SafeSignOutButton({ className }: { className?: string }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getLocalDataSummary>> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function openModal() { setSummary(await getLocalDataSummary()); setOpen(true); }
  async function signOutKeepingDeviceData() { setSigningOut(true); try { if (user?.uid) await saveCurrentAccountSnapshot(user.uid); await logout(); } finally { setSigningOut(false); } }
  async function syncThenSignOut() { if (!user?.uid) return signOutKeepingDeviceData(); setSyncing(true); const result = await syncAllToCloud(user.uid); setSyncing(false); if (!result) { setSummary(await getLocalDataSummary()); return; } await signOutKeepingDeviceData(); }

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  const hasUnsynced = Boolean(summary?.hasUnsyncedWork);
  const pendingCount = summary ? summary.pending + summary.failed + summary.syncing : 0;
  return <><button type="button" onClick={openModal} className={className ?? 'text-sm text-slate-500 hover:text-slate-700'}>Sign out</button><Modal open={open} title={isOffline ? 'You are offline' : hasUnsynced ? 'Unsynced changes' : 'Sign out?'} description={isOffline ? 'Changes saved on this device will stay linked to this account and sync when this same account is opened online again.' : hasUnsynced ? 'Some changes have not finished syncing yet. Sync before signing out to make them available on other devices.' : 'Your local data will stay safely stored for this account on this browser.'} onClose={() => setOpen(false)} footer={<><Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={signingOut || syncing}>Cancel</Button>{!isOffline && hasUnsynced && <Button type="button" onClick={syncThenSignOut} disabled={signingOut || syncing}>{syncing ? 'Syncing…' : 'Sync now, then sign out'}</Button>}<Button type="button" variant={hasUnsynced || isOffline ? 'danger' : 'primary'} onClick={signOutKeepingDeviceData} disabled={signingOut || syncing}>{signingOut ? 'Signing out…' : hasUnsynced || isOffline ? 'Sign out anyway' : 'Sign out'}</Button></>}>{summary && <div className="space-y-3 text-sm text-slate-600"><p>Data on this browser is preserved per account. Other accounts on this browser will not see this account&apos;s local data.</p><div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-50 p-3 text-xs"><div><span className="font-semibold text-slate-800">{summary.products}</span> products</div><div><span className="font-semibold text-slate-800">{summary.bills}</span> bills</div><div><span className="font-semibold text-slate-800">{summary.stockMovements}</span> stock movements</div><div><span className="font-semibold text-slate-800">{pendingCount}</span> pending sync jobs</div><div><span className="font-semibold text-slate-800">{summary.conflicts}</span> conflicts</div><div><span className="font-semibold text-slate-800">{summary.customerPayments}</span> payments</div></div>{summary.conflicts > 0 && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">Resolve conflicts before expecting every change to sync cleanly to the cloud.</p>}</div>}</Modal></>;
}
