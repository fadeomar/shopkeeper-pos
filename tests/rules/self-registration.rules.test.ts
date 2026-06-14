/**
 * Firestore security-rule tests for the self-service trial registration flow.
 *
 * These run against the Firestore emulator (NOT the mocked SDK the rest of the
 * vitest suite uses), so they have their own config — `vitest.rules.config.ts` —
 * which does not alias `firebase/firestore`. Launch them via:
 *
 *   npm run test:rules
 *
 * which wraps the run in `firebase emulators:exec --only firestore`. The
 * emulator requires Java; see README / PRODUCTION_QA.md for the one-time setup.
 *
 * What this verifies (the threat model in firestore.rules):
 *   - A signed-in new user may create ONLY their own active trial cashier
 *     profile, in the exact isSelfRegistrationShape() shape.
 *   - The old hole (unauthenticated create) is closed.
 *   - A user cannot self-grant admin role or a long/future paid subscription.
 *   - A user cannot create a profile for a different uid.
 *   - An active admin can still create a profile for another user.
 *   - A user cannot later mutate their own privileged subscription/role fields.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { doc, setDoc, getDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const PROJECT_ID = 'shopkeeper-rules-test';
const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

const DAY_MS = 86_400_000;

/**
 * The exact document shape auth-service.registerUser() writes for a trial.
 * Kept inline (rather than importing the app's buildTrialSubscription) so the
 * emulator test stays free of the app's Dexie/browser imports.
 */
function trialProfile(uid: string, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const end = new Date(now.getTime() + 14 * DAY_MS);
  return {
    uid,
    email: `${uid}@example.com`,
    name: 'Trial Tester',
    role: 'cashier',
    isActive: true,
    pendingApproval: false,
    accountType: 'trial',
    subscriptionStatus: 'trial',
    subscriptionStartAt: now.toISOString(),
    subscriptionEndAt: end.toISOString(),
    subscriptionEndAtMs: end.getTime(),
    subscriptionEndAtTimestamp: Timestamp.fromDate(end),
    lastRenewedAt: now.toISOString(),
    renewalCount: 0,
    createdAt: now.toISOString(),
    ...overrides,
  };
}

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(rulesPath, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('self-service trial registration', () => {
  it('lets a signed-in new user create their own active trial cashier profile', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', uid), trialProfile(uid)));
  });

  it('lets the profile omit the optional phone field', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    // trialProfile already omits `phone`; hasOnly() allows the subset.
    await assertSucceeds(setDoc(doc(db, 'users', uid), trialProfile(uid)));
  });

  it('allows the optional phone field when present', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', uid), trialProfile(uid, { phone: '+15550123' })),
    );
  });

  it('rejects an unauthenticated create (the old hole)', async () => {
    const uid = 'newuser1';
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'users', uid), trialProfile(uid)));
  });

  it('rejects creating a profile for a different uid', async () => {
    const db = testEnv.authenticatedContext('attacker').firestore();
    await assertFails(setDoc(doc(db, 'users', 'victim'), trialProfile('victim')));
  });

  it('rejects self-granting an admin (owner) role', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      setDoc(doc(db, 'users', uid), trialProfile(uid, { role: 'owner' })),
    );
  });

  it('rejects self-activation as a standard (paid) account', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      setDoc(
        doc(db, 'users', uid),
        trialProfile(uid, { accountType: 'standard', subscriptionStatus: 'active' }),
      ),
    );
  });

  it('rejects a subscription end further than 15 days out', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    const farEnd = new Date(Date.now() + 365 * DAY_MS);
    await assertFails(
      setDoc(
        doc(db, 'users', uid),
        trialProfile(uid, {
          subscriptionEndAt: farEnd.toISOString(),
          subscriptionEndAtMs: farEnd.getTime(),
          subscriptionEndAtTimestamp: Timestamp.fromDate(farEnd),
        }),
      ),
    );
  });

  it('rejects landing pre-approved as inactive/pending mismatch', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      setDoc(doc(db, 'users', uid), trialProfile(uid, { pendingApproval: true })),
    );
  });

  it('rejects a smuggled extra key not in the allowlist', async () => {
    const uid = 'newuser1';
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      setDoc(doc(db, 'users', uid), trialProfile(uid, { isSuperAdmin: true })),
    );
  });
});

describe('admin-created profiles', () => {
  /** Seed an active owner/admin profile, bypassing rules. */
  async function seedAdmin(uid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), {
        uid,
        email: `${uid}@example.com`,
        name: 'Shop Owner',
        role: 'owner',
        isActive: true,
        pendingApproval: false,
        createdAt: new Date().toISOString(),
      });
    });
  }

  it('lets an active admin create a profile for another user', async () => {
    await seedAdmin('admin1');
    const db = testEnv.authenticatedContext('admin1').firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', 'staff1'), {
        uid: 'staff1',
        email: 'staff1@example.com',
        name: 'New Cashier',
        role: 'cashier',
        isActive: true,
        pendingApproval: false,
        accountType: 'standard',
        subscriptionStatus: 'active',
        createdAt: new Date().toISOString(),
      }),
    );
  });
});

describe('profile self-update guards', () => {
  /** Seed an existing trial user, bypassing rules. */
  async function seedTrialUser(uid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), trialProfile(uid));
    });
  }

  it('lets the owner update a non-privileged field (name)', async () => {
    const uid = 'newuser1';
    await seedTrialUser(uid);
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', uid), { name: 'Renamed' }));
  });

  it('rejects the owner self-extending their subscription', async () => {
    const uid = 'newuser1';
    await seedTrialUser(uid);
    const db = testEnv.authenticatedContext(uid).firestore();
    const farEnd = new Date(Date.now() + 365 * DAY_MS);
    await assertFails(
      updateDoc(doc(db, 'users', uid), {
        subscriptionStatus: 'active',
        subscriptionEndAtTimestamp: Timestamp.fromDate(farEnd),
      }),
    );
  });

  it('rejects the owner promoting their own role', async () => {
    const uid = 'newuser1';
    await seedTrialUser(uid);
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(updateDoc(doc(db, 'users', uid), { role: 'owner' }));
  });

  it('keeps the user able to read their own profile after creation', async () => {
    const uid = 'newuser1';
    await seedTrialUser(uid);
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', uid)));
  });
});
