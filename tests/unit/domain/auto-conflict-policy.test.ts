import { describe, expect, it } from 'vitest';
import { decideAutoConflictResolution } from '@/lib/sync/auto-conflict-policy';
import type { SyncConflict } from '@/types/domain';

function conflict(partial: Partial<SyncConflict>): SyncConflict {
  return {
    id: 'conflict-1',
    entity: 'product',
    entityId: 'p1',
    conflictType: 'same_field_changed',
    severity: 'medium',
    cloudRecord: {},
    localRecord: {},
    changedFields: ['name'],
    status: 'open',
    createdAt: '2026-06-18T00:00:00.000Z',
    ...partial,
  };
}

describe('auto conflict policy', () => {
  it('keeps additive business events from two offline devices without showing conflict UI', () => {
    const decision = decideAutoConflictResolution(conflict({ entity: 'bill', conflictType: 'same_field_changed' }));
    expect(decision.resolution).toBe('keep_both');
    expect(decision.shouldShowToUser).toBe(false);
  });

  it('auto-merges non-inventory product field changes', () => {
    const decision = decideAutoConflictResolution(conflict({ changedFields: ['name', 'sellPrice'] }));
    expect(decision.resolution).toBe('merge');
    expect(decision.shouldShowToUser).toBe(false);
  });

  it('defers direct quantity conflicts until stock movement delta checks prove them safe', () => {
    const decision = decideAutoConflictResolution(conflict({ conflictType: 'inventory_overwrite', changedFields: ['quantityInStock'] }));
    expect(decision.resolution).toBe('defer');
    expect(decision.shouldShowToUser).toBe(false);
  });

  it('defers delete/update conflicts for owner review', () => {
    const decision = decideAutoConflictResolution(conflict({ conflictType: 'delete_vs_update', severity: 'critical' }));
    expect(decision.resolution).toBe('defer');
    expect(decision.shouldShowToUser).toBe(true);
  });

  it('auto-merges settings sequence fields to avoid noisy number conflicts', () => {
    const decision = decideAutoConflictResolution(conflict({ entity: 'settings', conflictType: 'settings_conflict', changedFields: ['nextBillSequence'] }));
    expect(decision.resolution).toBe('merge');
    expect(decision.shouldShowToUser).toBe(false);
  });
});
