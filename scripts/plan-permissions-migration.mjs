#!/usr/bin/env node
/**
 * Dry-run permissions migration helper.
 *
 * Usage (npm script loads .env.local via `node --env-file-if-exists`):
 *   npm run plan:permissions-migration                          # dry run
 *   APPLY_PERMISSIONS_MIGRATION=1 npm run plan:permissions-migration   # apply
 *
 * Credentials come from the app's FIREBASE_ADMIN_* env vars (pull with
 * `vercel env pull .env.local`) or GOOGLE_APPLICATION_CREDENTIALS — see
 * scripts/lib/admin-credentials.mjs.
 *
 * What it does:
 *   - Groups active users by effective storeId.
 *   - Finds stores whose only active role is legacy cashier.
 *   - Promotes exactly one active legacy cashier per affected store to owner
 *     ONLY when APPLY_PERMISSIONS_MIGRATION=1.
 *   - Never promotes pending/inactive/suspended accounts.
 */
import { initAdmin } from './lib/admin-credentials.mjs';

const admin = await initAdmin();
const db = admin.firestore();
const apply = process.env.APPLY_PERMISSIONS_MIGRATION === '1';

function effectiveStoreId(user) {
  return typeof user.storeId === 'string' && user.storeId.trim() ? user.storeId.trim() : user.uid;
}
function isUsable(user) {
  return user.isActive !== false && user.pendingApproval !== true && user.subscriptionStatus !== 'suspended' && user.subscriptionStatus !== 'expired';
}

const snap = await db.collection('users').get();
const byStore = new Map();
for (const doc of snap.docs) {
  const user = { uid: doc.id, ...doc.data() };
  if (user.role === 'administration' || user.role === 'admin') continue;
  const storeId = effectiveStoreId(user);
  const arr = byStore.get(storeId) ?? [];
  arr.push(user);
  byStore.set(storeId, arr);
}

const promotions = [];
for (const [storeId, users] of byStore.entries()) {
  const active = users.filter(isUsable);
  const hasOwner = users.some((u) => u.role === 'owner' || u.storeRole === 'owner');
  if (hasOwner) continue;

  const activeCashiers = active.filter((u) => u.role === 'cashier');
  const activeManagers = active.filter((u) => u.role === 'manager');
  const candidate = activeManagers[0] ?? activeCashiers[0];
  if (!candidate) continue;

  promotions.push({ storeId, uid: candidate.uid, email: candidate.email ?? null, fromRole: candidate.role, userCount: users.length });
}

console.log(JSON.stringify({ apply, scannedUsers: snap.size, stores: byStore.size, promotions }, null, 2));

if (apply) {
  const batch = db.batch();
  for (const item of promotions) {
    batch.update(db.collection('users').doc(item.uid), {
      role: 'owner',
      storeRole: 'owner',
      storeId: item.storeId,
      permissionsMigratedAt: admin.firestore.FieldValue.serverTimestamp(),
      permissionsMigrationSourceRole: item.fromRole,
    });
  }
  await batch.commit();
  console.log(`Applied ${promotions.length} owner promotion(s).`);
} else {
  console.log('Dry run only. Set APPLY_PERMISSIONS_MIGRATION=1 to apply.');
}
