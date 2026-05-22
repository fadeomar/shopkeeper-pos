/**
 * Tiny shared gate so the background sync loop can be paused without
 * forcing every caller to know about restore lifecycle.
 *
 * Why this exists:
 *   - SyncProvider mounts as soon as user.uid is available (root layout)
 *   - The restore decision (modal: "use cloud data?" / "start empty") lives
 *     inside CashierShell, which renders LATER in the tree
 *   - That ordering means runSync could push/pull cloud rows BEFORE the user
 *     decides whether to restore, racing with restoreFromCloud's clear+bulkPut
 *
 * Two gates:
 *   1. `restoreInProgress` — flipped on for the duration of restoreFromCloud
 *      so the sync loop skips that tick entirely. Strictly necessary; the
 *      restore transaction clears every business table.
 *   2. `restoreDecisionPending` — flipped on while CashierShell is running
 *      its initial restore check. Lets us defer the first sync run for a
 *      brand-new device until the user has chosen Restore or Skip.
 *
 * Both flags default to "open" so existing behavior is unchanged unless
 * something explicitly closes the gate.
 */

let restoreInProgress = false;
let restoreDecisionPending = false;

export function setRestoreInProgress(value: boolean): void {
  restoreInProgress = value;
}

export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

export function setRestoreDecisionPending(value: boolean): void {
  restoreDecisionPending = value;
}

export function isRestoreDecisionPending(): boolean {
  return restoreDecisionPending;
}

/** True if the sync loop should pause this tick. */
export function isSyncBlocked(): boolean {
  return restoreInProgress || restoreDecisionPending;
}
