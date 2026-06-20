import type { SyncConflict, SyncConflictResolution } from '@/types/domain';

export type AutoConflictDecision = {
  resolution: SyncConflictResolution | 'defer';
  shouldShowToUser: boolean;
  reason: string;
};

const ADDITIVE_ENTITIES = new Set([
  'bill',
  'stockMovement',
  'customerPayment',
  'supplierPayment',
  'auditEvent',
  'cashMovement',
  'expense',
  'billItemCostAllocation',
]);

const HARD_CONFLICT_TYPES = new Set([
  'delete_vs_update',
  'duplicate_record',
  'sale_state_conflict',
]);

const SEQUENCE_FIELDS = new Set(['nextBillSequence', 'nextPurchaseSequence']);

const PRODUCT_FIELDS_THAT_CAN_MERGE = new Set([
  'name',
  'category',
  'brand',
  'unit',
  'saleType',
  'defaultSaleUnitId',
  'buyPrice',
  'sellPrice',
  'minimumStockAlert',
  'supplierName',
  'expiryDate',
  'shelfLocation',
  'notes',
  'status',
]);

function changedFields(conflict: SyncConflict): string[] {
  return Array.isArray(conflict.changedFields) ? conflict.changedFields : [];
}

function isOnly(fields: string[], allowed: Set<string>): boolean {
  return fields.length > 0 && fields.every((field) => allowed.has(field));
}

/**
 * Offline-first conflict policy for the multi-user store sprint.
 *
 * Principle: accept and merge safe business events automatically; reserve UI
 * review for destructive or ambiguous mutations that could corrupt inventory,
 * delete edited records, or change financial state. This keeps cashier/owner
 * daily flows quiet while still preserving a review log for genuinely risky
 * cases.
 */
export function decideAutoConflictResolution(conflict: SyncConflict): AutoConflictDecision {
  const fields = changedFields(conflict);

  if (HARD_CONFLICT_TYPES.has(conflict.conflictType)) {
    return { resolution: 'defer', shouldShowToUser: conflict.severity === 'critical', reason: 'hard_conflict_requires_owner_review' };
  }

  if (ADDITIVE_ENTITIES.has(conflict.entity) && conflict.conflictType !== 'delete_vs_update') {
    return { resolution: 'keep_both', shouldShowToUser: false, reason: 'additive_event_keep_both' };
  }

  if (conflict.entity === 'settings' && isOnly(fields, SEQUENCE_FIELDS)) {
    return { resolution: 'merge', shouldShowToUser: false, reason: 'sequence_fields_auto_merge' };
  }

  if (conflict.entity === 'product') {
    if (isOnly(fields, PRODUCT_FIELDS_THAT_CAN_MERGE)) {
      return { resolution: 'merge', shouldShowToUser: false, reason: 'non_inventory_product_fields_auto_merge' };
    }

    // Quantity is only safe when it was produced by stock movement events; the
    // service layer performs that delta check before applying this policy.
    if (isOnly(fields, new Set(['quantityInStock']))) {
      return { resolution: 'defer', shouldShowToUser: false, reason: 'quantity_requires_stock_movement_delta_check' };
    }
  }

  if (conflict.severity === 'low') {
    return { resolution: 'merge', shouldShowToUser: false, reason: 'low_severity_auto_merge' };
  }

  return { resolution: 'defer', shouldShowToUser: conflict.severity === 'critical', reason: 'unsafe_or_ambiguous_conflict' };
}
