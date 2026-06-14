import { describe, expect, it } from 'vitest';
import { decideFieldLevelMerge } from '@/lib/services/field-level-merge';

describe('decideFieldLevelMerge (customers / suppliers)', () => {
  // 1 — customer phone vs notes = auto-merge
  it('merges disjoint customer field edits (phone vs notes)', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['phone'],
      cloudChangedFields: ['notes'],
    });
    expect(result.decision).toBe('merge');
    expect(result.conflictFields).toEqual([]);
  });

  // 2 — customer phone vs phone = conflict
  it('conflicts when both devices change the same customer field (phone vs phone)', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['phone'],
      cloudChangedFields: ['phone'],
    });
    expect(result.decision).toBe('conflict');
    expect(result.conflictFields).toEqual(['phone']);
  });

  // 3 — supplier name vs notes = auto-merge
  it('merges disjoint supplier field edits (name vs notes)', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['name'],
      cloudChangedFields: ['notes'],
    });
    expect(result.decision).toBe('merge');
  });

  // 4 — supplier name vs name = conflict
  it('conflicts when both devices change the same supplier field (name vs name)', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['name'],
      cloudChangedFields: ['name'],
    });
    expect(result.decision).toBe('conflict');
    expect(result.conflictFields).toEqual(['name']);
  });

  // 5 — delete vs update = conflict
  it('conflicts on local delete vs cloud update', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: [],
      cloudChangedFields: ['phone'],
      localDeleted: true,
    });
    expect(result.decision).toBe('conflict');
  });

  it('conflicts on cloud delete vs local update', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['name'],
      cloudChangedFields: [],
      cloudDeleted: true,
    });
    expect(result.decision).toBe('conflict');
  });

  it('reports only the overlapping fields as conflicting when edits partially overlap', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: ['phone', 'address'],
      cloudChangedFields: ['phone', 'notes'],
    });
    expect(result.decision).toBe('conflict');
    expect(result.conflictFields).toEqual(['phone']);
  });

  it('merges when only one side changed anything', () => {
    expect(
      decideFieldLevelMerge({ localChangedFields: ['phone'], cloudChangedFields: [] }).decision,
    ).toBe('merge');
    expect(
      decideFieldLevelMerge({ localChangedFields: [], cloudChangedFields: ['notes'] }).decision,
    ).toBe('merge');
  });

  it('merges when both sides deleted the record', () => {
    const result = decideFieldLevelMerge({
      localChangedFields: [],
      cloudChangedFields: [],
      localDeleted: true,
      cloudDeleted: true,
    });
    expect(result.decision).toBe('merge');
  });
});
