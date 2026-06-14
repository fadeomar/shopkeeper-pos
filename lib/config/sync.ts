/**
 * Central sync configuration. Keeps tunables out of component bodies so they
 * can be configured per-environment and disabled in tests (a hardcoded polling
 * interval makes test processes hang and can't be tuned in production).
 *
 * Client-readable env vars MUST be prefixed NEXT_PUBLIC_ to survive the Next.js
 * client bundle.
 */

const DEFAULT_SYNC_POLL_INTERVAL_MS = 30_000;

function parseInterval(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SYNC_POLL_INTERVAL_MS;
}

/**
 * Background pull cadence while the app is visible + online. Defaults to 30s.
 * Override with NEXT_PUBLIC_SYNC_POLL_INTERVAL_MS.
 */
export const SYNC_POLL_INTERVAL_MS = parseInterval(
  process.env.NEXT_PUBLIC_SYNC_POLL_INTERVAL_MS,
);

/**
 * Polling is disabled under test (so vitest processes never hang on a live
 * interval) and can be explicitly disabled in any environment. Reconnect /
 * visibility / local-write triggers still fire — only the timer is suppressed.
 */
export const isSyncPollingDisabled =
  process.env.NODE_ENV === 'test' ||
  process.env.NEXT_PUBLIC_DISABLE_SYNC_POLLING === '1';
