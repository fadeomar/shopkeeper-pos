import { describe, expect, it, vi } from 'vitest';
import {
  addCalendarMonths,
  addDays,
  buildInitialPaidSubscription,
  buildTrialSubscription,
  canUserWrite,
  getSubscriptionAccessState,
  isSubscriptionStatus,
  subscriptionDaysRemaining,
  subscriptionExpiryDateLabel,
  toSubscriptionMs,
  TRIAL_DAYS,
} from '@/lib/services/subscription-service';
import { makeAppUser } from '@/tests/helpers/builders';

describe('subscription pure rules', () => {
  it('adds trial days and calendar months predictably', () => {
    const start = new Date('2026-01-31T10:00:00.000Z');

    expect(addDays(start, TRIAL_DAYS).toISOString()).toBe('2026-02-14T10:00:00.000Z');
    expect(addCalendarMonths(start, 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });

  it('builds trial and paid subscription payloads with expected status and counters', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const trial = buildTrialSubscription(now);
    const paid = buildInitialPaidSubscription(now, 2);

    expect(trial.accountType).toBe('trial');
    expect(trial.subscriptionStatus).toBe('trial');
    expect(trial.renewalCount).toBe(0);
    expect(trial.subscriptionEndAt).toBe('2026-01-15T00:00:00.000Z');

    expect(paid.accountType).toBe('standard');
    expect(paid.subscriptionStatus).toBe('active');
    expect(paid.renewalCount).toBe(1);
    expect(paid.subscriptionEndAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('resolves access states for legacy, inactive, pending, suspended, active, and expired users', () => {
    vi.setSystemTime(new Date('2026-01-10T00:00:00.000Z'));

    expect(getSubscriptionAccessState(null)).toBe('inactive');
    expect(getSubscriptionAccessState(makeAppUser({ subscriptionStatus: undefined }))).toBe('legacy');
    expect(getSubscriptionAccessState(makeAppUser({ isActive: false, subscriptionStatus: 'active' }))).toBe('inactive');
    expect(getSubscriptionAccessState(makeAppUser({ pendingApproval: true, subscriptionStatus: 'active' }))).toBe('inactive');
    expect(getSubscriptionAccessState(makeAppUser({ subscriptionStatus: 'suspended' }))).toBe('suspended');
    expect(getSubscriptionAccessState(makeAppUser({ subscriptionStatus: 'expired' }))).toBe('expired');
    expect(getSubscriptionAccessState(makeAppUser({ subscriptionStatus: 'active', subscriptionEndAtMs: Date.now() + 1000 }))).toBe('active');
    expect(getSubscriptionAccessState(makeAppUser({ subscriptionStatus: 'active', subscriptionEndAtMs: Date.now() - 1000 }))).toBe('expired');
  });

  it('allows writes only for legacy, trial, and active subscription states', () => {
    vi.setSystemTime(new Date('2026-01-10T00:00:00.000Z'));

    expect(canUserWrite(makeAppUser({ subscriptionStatus: undefined }))).toBe(true);
    expect(canUserWrite(makeAppUser({ subscriptionStatus: 'trial', subscriptionEndAtMs: Date.now() + 1000 }))).toBe(true);
    expect(canUserWrite(makeAppUser({ subscriptionStatus: 'active', subscriptionEndAtMs: Date.now() + 1000 }))).toBe(true);
    expect(canUserWrite(makeAppUser({ subscriptionStatus: 'expired' }))).toBe(false);
    expect(canUserWrite(makeAppUser({ subscriptionStatus: 'suspended' }))).toBe(false);
  });

  it('normalizes expiry inputs and user-facing expiry labels', () => {
    vi.setSystemTime(new Date('2026-01-10T00:00:00.000Z'));
    const user = makeAppUser({ subscriptionStatus: 'trial', subscriptionEndAt: '2026-01-12T00:00:00.000Z' });

    expect(toSubscriptionMs(undefined, 123)).toBe(123);
    expect(toSubscriptionMs('bad-date')).toBeNull();
    expect(subscriptionDaysRemaining(user)).toBe(2);
    expect(subscriptionExpiryDateLabel(user)).toBe('2026-01-12');
    expect(subscriptionExpiryDateLabel(makeAppUser())).toBe('—');
  });

  it('validates subscription status values', () => {
    expect(isSubscriptionStatus('trial')).toBe(true);
    expect(isSubscriptionStatus('active')).toBe(true);
    expect(isSubscriptionStatus('expired')).toBe(true);
    expect(isSubscriptionStatus('suspended')).toBe(true);
    expect(isSubscriptionStatus('legacy')).toBe(false);
  });
});
