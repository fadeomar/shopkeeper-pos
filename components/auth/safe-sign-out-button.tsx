"use client";

/**
 * SafeSignOutButton — sign-out trigger that first surfaces how much local data
 * has not yet reached the cloud, so a cashier never signs out and silently
 * strands unsynced bills/purchases on the device. Used in the desktop sidebar
 * foot and in the mobile More → Account section.
 *
 * Extracted from authenticated-shell so the mobile bottom-nav can reuse it
 * without importing the whole shell.
 */

import { useState } from "react";
import { useAuth } from "@/components/providers/auth-context";
import { useLocale } from "@/components/providers/locale-context";
import { syncAllToCloud } from "@/lib/firebase/sync-service";
import {
  getLocalDataSummary,
  saveCurrentAccountSnapshot,
} from "@/lib/services/account-data-service";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export function SafeSignOutButton({ className }: { className?: string }) {
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
