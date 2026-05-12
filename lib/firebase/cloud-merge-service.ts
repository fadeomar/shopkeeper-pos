import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { firestore } from '@/lib/firebase/config';
import { saveConflict } from '@/lib/services/sync-conflict-service';
import type { Product, Settings, SyncQueueItem } from '@/types/domain';

type ConflictCheckResult = { hasConflict: boolean; conflictId?: string };
type SettingsSyncPreparation = ConflictCheckResult & { settings: Settings };

const PRODUCT_FIELDS: Array<keyof Product> = [
  'barcode',
  'name',
  'category',
  'brand',
  'unit',
  'quantityInStock',
  'buyPrice',
  'sellPrice',
  'minimumStockAlert',
  'supplierName',
  'expiryDate',
  'shelfLocation',
  'notes',
  'status',
];

const SETTINGS_FIELDS: Array<keyof Settings> = [
  'storeName',
  'cashierName',
  'currency',
  'allowLossSale',
  'nextBillSequence',
  'lowStockHighlight',
];

function valuesDiffer(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);
}

function changedFields<T extends Record<string, unknown>>(local: T, cloud: T, fields: string[]): string[] {
  return fields.filter((field) => valuesDiffer(local[field], cloud[field]));
}

function isCloudNewerThanLocal(localSyncedAt?: string, cloudSyncedAt?: string): boolean {
  if (!cloudSyncedAt) return false;
  if (!localSyncedAt) return true;
  return new Date(cloudSyncedAt).getTime() > new Date(localSyncedAt).getTime();
}

function finiteSequence(value: unknown, fallback = 1): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function laterIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime)) return b;
  if (!Number.isFinite(bTime)) return a;
  return bTime > aTime ? b : a;
}

function saveOrIgnoreConflict(
  conflict: Parameters<typeof saveConflict>[0],
): Promise<ConflictCheckResult> {
  return saveConflict(conflict).then((conflictId) => (
    conflictId ? { hasConflict: true, conflictId } : { hasConflict: false }
  ));
}

export async function detectProductCloudConflict(
  uid: string,
  product: Product,
  job: SyncQueueItem,
): Promise<ConflictCheckResult> {
  const sameIdSnap = await getDoc(doc(firestore, `users/${uid}/products/${product.id}`));
  if (sameIdSnap.exists()) {
    const cloud = sameIdSnap.data() as Product;
    const fields = changedFields(product as unknown as Record<string, unknown>, cloud as unknown as Record<string, unknown>, PRODUCT_FIELDS as string[]);
    if (fields.length > 0 && isCloudNewerThanLocal(product.syncedAt ?? job.createdAt, cloud.syncedAt)) {
      return saveOrIgnoreConflict({
        id: `conflict:product:${product.id}:same-field`,
        entity: 'product',
        entityId: product.id,
        operationId: job.id,
        conflictType: 'same_field_changed',
        severity: fields.includes('quantityInStock') ? 'high' : 'medium',
        cloudRecord: cloud as unknown as Record<string, unknown>,
        localRecord: product as unknown as Record<string, unknown>,
        changedFields: fields,
      });
    }
  }

  if (product.barcode?.trim()) {
    const duplicates = await getDocs(query(
      collection(firestore, `users/${uid}/products`),
      where('barcode', '==', product.barcode.trim()),
      limit(2),
    ));
    const duplicate = duplicates.docs
      .map((snapshot) => snapshot.data() as Product)
      .find((cloud) => cloud.id !== product.id);

    if (duplicate) {
      return saveOrIgnoreConflict({
        id: `conflict:product:${product.id}:duplicate-barcode:${duplicate.id}`,
        entity: 'product',
        entityId: product.id,
        operationId: job.id,
        conflictType: 'duplicate_record',
        severity: 'high',
        cloudRecord: duplicate as unknown as Record<string, unknown>,
        localRecord: product as unknown as Record<string, unknown>,
        changedFields: ['barcode'],
      });
    }
  }

  return { hasConflict: false };
}

export async function prepareSettingsForCloudSync(
  uid: string,
  settings: Settings,
  job: SyncQueueItem,
): Promise<SettingsSyncPreparation> {
  const snap = await getDoc(doc(firestore, `users/${uid}/settings/${settings.id}`));
  if (!snap.exists()) return { hasConflict: false, settings };

  const cloud = snap.data() as Settings;
  const fields = changedFields(settings as unknown as Record<string, unknown>, cloud as unknown as Record<string, unknown>, SETTINGS_FIELDS as string[]);
  const safeNextBillSequence = Math.max(
    finiteSequence(settings.nextBillSequence),
    finiteSequence(cloud.nextBillSequence),
  );
  const safeSettings: Settings = {
    ...settings,
    nextBillSequence: safeNextBillSequence,
    updatedAt: laterIso(settings.updatedAt, cloud.updatedAt) ?? settings.updatedAt,
  };

  if (fields.length > 0 && isCloudNewerThanLocal(settings.syncedAt ?? job.createdAt, cloud.syncedAt)) {
    const businessFields = fields.filter((field) => field !== 'nextBillSequence');

    // Bill numbers are monotonic counters. Offline bill creation can legitimately
    // make the device sequence higher than the cloud. Merge with max instead of
    // forcing a manual settings conflict.
    if (businessFields.length === 0) {
      return { hasConflict: false, settings: safeSettings };
    }

    const result = await saveOrIgnoreConflict({
      id: `conflict:settings:${settings.id}:same-field`,
      entity: 'settings',
      entityId: settings.id,
      operationId: job.id,
      conflictType: 'settings_conflict',
      severity: businessFields.some((field) => ['currency'].includes(field)) ? 'critical' : 'high',
      cloudRecord: cloud as unknown as Record<string, unknown>,
      localRecord: settings as unknown as Record<string, unknown>,
      changedFields: fields,
    });
    return { ...result, settings: safeSettings };
  }

  return { hasConflict: false, settings: safeSettings };
}

export async function detectSettingsCloudConflict(
  uid: string,
  settings: Settings,
  job: SyncQueueItem,
): Promise<ConflictCheckResult> {
  const prepared = await prepareSettingsForCloudSync(uid, settings, job);
  return prepared.hasConflict
    ? { hasConflict: true, conflictId: prepared.conflictId }
    : { hasConflict: false };
}
