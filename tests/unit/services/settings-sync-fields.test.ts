import { describe, expect, it } from 'vitest';
import {
  SETTINGS_BUSINESS_FIELDS,
  SETTINGS_SEQUENCE_FIELDS,
  SETTINGS_TRACKED_FIELDS,
  finiteSequence,
  isSettingsSequenceField,
  mergedSequences,
} from '@/lib/services/settings-sync-fields';

describe('finiteSequence', () => {
  it('floors valid positive numbers', () => {
    expect(finiteSequence(5)).toBe(5);
    expect(finiteSequence(5.9)).toBe(5);
  });

  it('coerces numeric strings', () => {
    expect(finiteSequence('7')).toBe(7);
  });

  it('falls back for zero, negative, non-finite, or non-numeric values', () => {
    expect(finiteSequence(0)).toBe(1);
    expect(finiteSequence(-3)).toBe(1);
    expect(finiteSequence(Number.NaN)).toBe(1);
    expect(finiteSequence(undefined)).toBe(1);
    expect(finiteSequence('abc')).toBe(1);
  });

  it('honours a custom fallback', () => {
    expect(finiteSequence(undefined, 10)).toBe(10);
  });
});

describe('mergedSequences', () => {
  it('takes the max of each monotonic counter across local and cloud', () => {
    expect(mergedSequences(
      { nextBillSequence: 5, nextPurchaseSequence: 3 },
      { nextBillSequence: 2, nextPurchaseSequence: 9 },
    )).toEqual({ nextBillSequence: 5, nextPurchaseSequence: 9 });
  });

  it('never regresses a counter when one side is missing or invalid', () => {
    expect(mergedSequences(
      { nextBillSequence: 12 },
      { nextBillSequence: undefined, nextPurchaseSequence: 4 },
    )).toEqual({ nextBillSequence: 12, nextPurchaseSequence: 4 });
  });
});

describe('isSettingsSequenceField', () => {
  it('is true only for the monotonic counter fields', () => {
    expect(isSettingsSequenceField('nextBillSequence')).toBe(true);
    expect(isSettingsSequenceField('nextPurchaseSequence')).toBe(true);
    expect(isSettingsSequenceField('currency')).toBe(false);
    expect(isSettingsSequenceField('storeName')).toBe(false);
  });
});

describe('SETTINGS_TRACKED_FIELDS', () => {
  it('is the union of business fields plus the two sequence counters with no omissions', () => {
    expect(SETTINGS_TRACKED_FIELDS).toHaveLength(SETTINGS_BUSINESS_FIELDS.length + SETTINGS_SEQUENCE_FIELDS.length);
    // Spot-check the high-risk business fields that were previously droppable.
    expect(SETTINGS_TRACKED_FIELDS).toEqual(expect.arrayContaining([
      'currency',
      'rolePermissions',
      'requireShift',
      'defaultDiscountLimit',
      'nextBillSequence',
      'nextPurchaseSequence',
    ]));
  });
});
