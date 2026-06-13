import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateTime, localDateKey, nowIso } from '@/lib/utils/date';

afterEach(() => {
  vi.useRealTimers();
});

describe('nowIso', () => {
  it('returns the current instant as an ISO-8601 string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T08:30:00.000Z'));
    expect(nowIso()).toBe('2026-03-05T08:30:00.000Z');
  });
});

describe('localDateKey', () => {
  it('formats a YYYY-MM-DD key with zero-padded month and day', () => {
    expect(localDateKey(new Date('2026-01-07T10:00:00.000Z'))).toBe('2026-01-07');
    expect(localDateKey(new Date('2026-12-31T10:00:00.000Z'))).toBe('2026-12-31');
  });

  it('uses local calendar fields (getFullYear/getMonth/getDate), not the UTC ISO slice', () => {
    const date = new Date('2026-06-15T12:00:00.000Z');
    const expected = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    expect(localDateKey(date)).toBe(expected);
  });

  it('defaults to the current local day when called without an argument', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-09T15:45:00.000Z'));
    expect(localDateKey()).toBe('2026-02-09');
  });
});

describe('formatDate / formatDateTime', () => {
  // Locale-specific output varies by runtime ICU data, so we assert the stable
  // parts (the year is present and the call does not throw) rather than an
  // exact localized string.
  it('renders a non-empty localized string that includes the year', () => {
    expect(formatDate('2026-01-15T10:00:00.000Z')).toContain('2026');
    expect(formatDateTime('2026-01-15T10:00:00.000Z')).toContain('2026');
  });
});
