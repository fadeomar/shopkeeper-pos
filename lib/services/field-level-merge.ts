/**
 * Field-level merge decision for record-shaped entities (customers, suppliers).
 *
 * Goal: a same-record edit on two devices should only be a TRUE conflict when
 * the two devices changed the SAME field to different values. Disjoint field
 * edits (Device A changed phone, Device B changed notes) merge safely.
 *
 * This is a PURE decision given the set of fields each side changed since the
 * last common sync. It deliberately does not read the DB so it can be unit
 * tested exhaustively.
 *
 * LIMITATION (documented): computing `localChangedFields` / `cloudChangedFields`
 * precisely requires a per-record "last synced snapshot" base to diff against.
 * The current schema does not persist that base, so full automatic wiring into
 * the pull path is a follow-up: store the synced field values on each record
 * (or a hash per field) and pass the diffs here. Until then this helper is the
 * tested decision core, and the pull path keeps its existing conservative
 * behavior (pending local edit wins on push; otherwise newer cloud is pulled).
 */

export type FieldMergeDecision = 'merge' | 'conflict';

export interface FieldMergeInput {
  /** Fields this device changed since the last common sync. */
  localChangedFields: string[];
  /** Fields the cloud changed since the last common sync. */
  cloudChangedFields: string[];
  /** This device deleted the record. */
  localDeleted?: boolean;
  /** The cloud deleted the record. */
  cloudDeleted?: boolean;
}

export interface FieldMergeResult {
  decision: FieldMergeDecision;
  /** The overlapping fields that make this a true conflict (empty when merge). */
  conflictFields: string[];
}

function intersect(a: string[], b: string[]): string[] {
  const bSet = new Set(b);
  return Array.from(new Set(a.filter((field) => bSet.has(field))));
}

/**
 * Decide whether two same-record edits can merge or are a true conflict.
 *
 *   - delete on one side + edit on the other  → conflict (unsafe to drop edits)
 *   - both sides changed the SAME field        → conflict (different values)
 *   - changes touch disjoint fields            → merge
 *   - only one side changed anything           → merge (other side is a no-op)
 */
export function decideFieldLevelMerge(input: FieldMergeInput): FieldMergeResult {
  const localChanged = input.localChangedFields.length > 0;
  const cloudChanged = input.cloudChangedFields.length > 0;

  // delete-vs-update is a true conflict — we must not silently discard the
  // surviving edit by honoring the delete (or vice-versa). A delete with no
  // competing edit on the other side (or both deleted) is safe to apply.
  if (input.localDeleted && cloudChanged) {
    return { decision: 'conflict', conflictFields: [] };
  }
  if (input.cloudDeleted && localChanged) {
    return { decision: 'conflict', conflictFields: [] };
  }
  if (input.localDeleted || input.cloudDeleted) {
    return { decision: 'merge', conflictFields: [] };
  }

  const overlap = intersect(input.localChangedFields, input.cloudChangedFields);
  if (overlap.length > 0) {
    return { decision: 'conflict', conflictFields: overlap };
  }

  return { decision: 'merge', conflictFields: [] };
}
