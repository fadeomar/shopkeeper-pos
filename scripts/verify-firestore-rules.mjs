#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rulesPath = resolve(here, '..', 'firestore.rules');
const rules = readFileSync(rulesPath, 'utf8');

const checks = [
  {
    name: 'owner role is admin-capable',
    pass: /userDoc\(request\.auth\.uid\)\.role == 'owner'/.test(rules),
    hint: 'isActiveAdmin() must treat role=owner as the canonical app admin role.',
  },
  {
    name: 'cashier self-registration is constrained to trial cashier shape',
    pass: /function isSelfRegistrationShape\(uid\)/.test(rules)
      && /role == 'cashier'/.test(rules)
      && /subscriptionStatus == 'trial'/.test(rules)
      && /request\.resource\.data\.keys\(\)\.hasOnly/.test(rules)
      && /allow create: if \(isOwner\(uid\) && isSelfRegistrationShape\(uid\)\)/.test(rules),
    hint: 'Self-registration must only allow the signed-in new user to create the exact trial cashier profile shape.',
  },
  {
    name: 'trial window is capped at 15 days in rules',
    pass: /duration\.value\(15, 'd'\)/.test(rules),
    hint: 'Self-registration should not be able to create a long/future paid subscription.',
  },
  {
    name: 'cashier cannot update privileged profile fields',
    pass: /affectedKeys\(\)[\s\S]*subscriptionStatus[\s\S]*subscriptionEndAtTimestamp/.test(rules)
      && /affectedKeys\(\)[\s\S]*role[\s\S]*isActive[\s\S]*pendingApproval/.test(rules),
    hint: 'Users must not update role, activation, approval, or subscription fields on their own profile.',
  },
  {
    name: 'expired/suspended users cannot write POS data',
    pass: /function subscriptionCanWrite\(uid\)/.test(rules)
      && /subscriptionStatus == 'active'/.test(rules)
      && /subscriptionStatus == 'trial'/.test(rules)
      && /subscriptionEndAtTimestamp >= request\.time/.test(rules),
    hint: 'POS writes must require active/trial subscription within its end timestamp.',
  },
  {
    name: 'generic POS write rule excludes protected subcollections',
    pass: /function isProtectedUserSubcollection\(collection\)/.test(rules)
      && /collection == 'settings'/.test(rules)
      && /collection == 'subscriptionRenewals'/.test(rules)
      && /allow write: if !isProtectedUserSubcollection\(collection\) && isActiveOwner\(uid\)/.test(rules),
    hint: 'Firestore ORs overlapping matches, so generic POS writes must not cover settings or subscriptionRenewals.',
  },
  {
    name: 'subscription renewal audit trail is append-only for admins',
    pass: /match \/subscriptionRenewals\/\{docId\}[\s\S]*allow create: if isActiveAdmin\(\);[\s\S]*allow update, delete: if false;/.test(rules),
    hint: 'Renewal history must not be editable/deletable from the client.',
  },
];

let failed = 0;
for (const check of checks) {
  if (check.pass) {
    console.log(`✓ ${check.name}`);
  } else {
    failed += 1;
    console.error(`✗ ${check.name}`);
    console.error(`  ${check.hint}`);
  }
}

if (failed > 0) {
  console.error(`\nFirestore rule smoke check failed: ${failed} issue(s).`);
  process.exit(1);
}

console.log('\nFirestore rule smoke check passed. Run the Firebase emulator for end-to-end rule tests before production deploy.');
