import { Timestamp } from 'firebase/firestore';
import { AppError, AppErrorCode } from '@/lib/errors/app-error';
import { db } from '@/lib/db/schema';
import { getActiveUid } from '@/lib/services/account-data-service';
import type { AppUser, SubscriptionStatus } from '@/types/domain';

export const TRIAL_DAYS = 14;

export type SubscriptionAccessState =
  | 'legacy'
  | 'trial'
  | 'active'
  | 'expired'
  | 'suspended'
  | 'inactive';

const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function addCalendarMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const originalDate = next.getDate();
  next.setMonth(next.getMonth() + months);

  // JavaScript rolls Jan 31 + 1 month into March. Clamp back to the last day
  // of the target month so subscription renewals are predictable.
  if (next.getDate() !== originalDate) {
    next.setDate(0);
  }
  return next;
}

export function toSubscriptionMs(value?: string, valueMs?: number): number | null {
  if (typeof valueMs === 'number' && Number.isFinite(valueMs)) return valueMs;
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getSubscriptionAccessState(user: AppUser | null | undefined): SubscriptionAccessState {
  if (!user) return 'inactive';
  if (!user.isActive || user.pendingApproval) return 'inactive';

  const status = user.subscriptionStatus;
  if (!status) return 'legacy';
  if (status === 'suspended') return 'suspended';
  if (status === 'expired') return 'expired';

  const endAtMs = toSubscriptionMs(user.subscriptionEndAt, user.subscriptionEndAtMs);
  if (endAtMs !== null && Date.now() > endAtMs) return 'expired';

  return status;
}

export function canUserWrite(user: AppUser | null | undefined): boolean {
  const state = getSubscriptionAccessState(user);
  return state === 'legacy' || state === 'trial' || state === 'active';
}

export function subscriptionDaysRemaining(user: AppUser): number | null {
  const endAtMs = toSubscriptionMs(user.subscriptionEndAt, user.subscriptionEndAtMs);
  if (endAtMs === null) return null;
  return Math.ceil((endAtMs - Date.now()) / DAY_MS);
}

export function buildTrialSubscription(now = new Date()): Pick<
  AppUser,
  | 'accountType'
  | 'subscriptionStatus'
  | 'subscriptionStartAt'
  | 'subscriptionEndAt'
  | 'subscriptionEndAtMs'
  | 'subscriptionEndAtTimestamp'
  | 'lastRenewedAt'
  | 'renewalCount'
> {
  const end = addDays(now, TRIAL_DAYS);
  return {
    accountType: 'trial',
    subscriptionStatus: 'trial',
    subscriptionStartAt: now.toISOString(),
    subscriptionEndAt: end.toISOString(),
    subscriptionEndAtMs: end.getTime(),
    subscriptionEndAtTimestamp: Timestamp.fromDate(end),
    lastRenewedAt: now.toISOString(),
    renewalCount: 0,
  };
}

export function buildInitialPaidSubscription(now = new Date(), months = 1): Pick<
  AppUser,
  | 'accountType'
  | 'subscriptionStatus'
  | 'subscriptionStartAt'
  | 'subscriptionEndAt'
  | 'subscriptionEndAtMs'
  | 'subscriptionEndAtTimestamp'
  | 'lastRenewedAt'
  | 'renewalCount'
> {
  const end = addCalendarMonths(now, months);
  return {
    accountType: 'standard',
    subscriptionStatus: 'active',
    subscriptionStartAt: now.toISOString(),
    subscriptionEndAt: end.toISOString(),
    subscriptionEndAtMs: end.getTime(),
    subscriptionEndAtTimestamp: Timestamp.fromDate(end),
    lastRenewedAt: now.toISOString(),
    renewalCount: 1,
  };
}

export async function assertSubscriptionCanWrite(): Promise<void> {
  const uid = getActiveUid();
  if (!uid) throw new AppError(AppErrorCode.SUBSCRIPTION_WRITE_BLOCKED);

  if (!db.isOpen()) {
    try { await db.open(); } catch { /* handled by auth/db bootstrap elsewhere */ }
  }

  const cached = await db.authCache.get(uid).catch(() => undefined);
  const state = getSubscriptionAccessState(cached);

  if (state === 'suspended') throw new AppError(AppErrorCode.SUBSCRIPTION_SUSPENDED);
  if (state === 'expired') throw new AppError(AppErrorCode.SUBSCRIPTION_EXPIRED);
  if (state === 'inactive') throw new AppError(AppErrorCode.SUBSCRIPTION_WRITE_BLOCKED);
}

export function subscriptionExpiryDateLabel(user: AppUser): string {
  const endAtMs = toSubscriptionMs(user.subscriptionEndAt, user.subscriptionEndAtMs);
  if (endAtMs === null) return '—';
  return new Date(endAtMs).toISOString().slice(0, 10);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return value === 'trial' || value === 'active' || value === 'expired' || value === 'suspended';
}
