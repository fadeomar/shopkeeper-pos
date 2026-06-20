#!/usr/bin/env node
/**
 * Deploy firestore.rules to the live Firebase project.
 *
 * Why this exists: merging to main + the Vercel app deploy do NOT update
 * Firestore security rules — rules live in the Firebase project and ship
 * separately. Forgetting this caused a production incident (admins with the new
 * `administration` role couldn't read /users because the live rules were stale).
 *
 * This deploys via the Firebase Rules REST API authenticated with the app's
 * own `FIREBASE_ADMIN_*` service-account env vars, so it works headless and
 * doesn't depend on an interactive `firebase login` (whose token expires).
 *
 * Usage:
 *   npm run deploy:rules                 # uses .env.local (FIREBASE_ADMIN_*)
 *   DRY_RUN=1 npm run deploy:rules       # validate + print, do not release
 *
 * The npm script loads .env.local via `node --env-file-if-exists`. Populate it
 * with `vercel env pull .env.local`, or set GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Note: on Windows you may see a harmless "Assertion failed: ... async.c" line
 * AFTER the success message — that's a libuv teardown artifact when the
 * auth client's keep-alive socket closes on exit. The exit code is still 0;
 * trust the printed "Deployed."/"Compiled OK." result, not that line.
 */
import { readFileSync } from 'node:fs';
import { getAccessToken } from './lib/admin-credentials.mjs';

const RULES_FILE = 'firestore.rules';
const dryRun = process.env.DRY_RUN === '1';

const rules = readFileSync(RULES_FILE, 'utf8');
const { token, projectId } = await getAccessToken();
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const base = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;

// 1) Create a ruleset from firestore.rules (this also compiles/validates it).
const createRes = await fetch(`${base}/rulesets`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ source: { files: [{ name: RULES_FILE, content: rules }] } }),
});
const created = await createRes.json();
if (!createRes.ok) {
  console.error('Ruleset creation/compilation FAILED:');
  console.error(JSON.stringify(created, null, 2));
  process.exit(1);
}
console.log(`Compiled OK. Ruleset: ${created.name}`);

if (dryRun) {
  console.log('DRY_RUN=1 — not releasing. Live rules unchanged.');
  process.exit(0);
}

// 2) Point the cloud.firestore release at the new ruleset (this goes live).
const relRes = await fetch(`${base}/releases/cloud.firestore`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: created.name },
  }),
});
const rel = await relRes.json();
if (!relRes.ok) {
  console.error('Release FAILED:');
  console.error(JSON.stringify(rel, null, 2));
  process.exit(1);
}
console.log(`Deployed. cloud.firestore now serving: ${rel.rulesetName}`);
