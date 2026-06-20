/**
 * Shared Firebase Admin credential resolution for one-off ops scripts
 * (migrations, rules deploys, etc.).
 *
 * Preferred source: the SAME `FIREBASE_ADMIN_*` env vars the app already uses
 * server-side (see lib/firebase/firebase-admin.ts). Pull them locally with
 * `vercel env pull .env.local` so you never have to download a raw
 * service-account JSON key — downloaded keys are long-lived secrets that tend
 * to linger in Downloads folders.
 *
 * Fallback: a service-account JSON file pointed to by
 * GOOGLE_APPLICATION_CREDENTIALS (the classic ADC mechanism), for environments
 * that already have one.
 *
 * Load env first with Node's built-in flag (no dotenv dependency):
 *   node --env-file-if-exists=.env.local scripts/<name>.mjs
 */
import { readFileSync } from 'node:fs';

function normalizePrivateKey(value) {
  if (!value) return undefined;
  // Vercel/.env often store the key on one line with escaped newlines, and some
  // dashboards wrap it in quotes. Support both.
  const unquoted = value.trim().replace(/^['"]|['"]$/g, '');
  return unquoted.replace(/\\n/g, '\n');
}

function privateKeyFromEnv() {
  const direct = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  if (direct) return direct;
  const b64 = process.env.FIREBASE_ADMIN_PRIVATE_KEY_BASE64?.trim();
  if (!b64) return undefined;
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

/**
 * Resolve { projectId, clientEmail, privateKey }. Throws a clear, actionable
 * error if nothing is configured.
 */
export function resolveServiceAccount() {
  // 1) FIREBASE_ADMIN_* env vars (preferred — matches the app).
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = privateKeyFromEnv();
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey, source: 'env' };
  }

  // 2) GOOGLE_APPLICATION_CREDENTIALS JSON file (fallback).
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (keyFile) {
    try {
      const json = JSON.parse(readFileSync(keyFile, 'utf8'));
      if (json.project_id && json.client_email && json.private_key) {
        return {
          projectId: json.project_id,
          clientEmail: json.client_email,
          privateKey: json.private_key,
          source: 'file',
        };
      }
    } catch (err) {
      throw new Error(`Could not read GOOGLE_APPLICATION_CREDENTIALS file "${keyFile}": ${err.message}`);
    }
  }

  throw new Error(
    'Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, ' +
      'FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY (or ' +
      'FIREBASE_ADMIN_PRIVATE_KEY_BASE64) — e.g. `vercel env pull .env.local` ' +
      'then run via `node --env-file-if-exists=.env.local` — or point ' +
      'GOOGLE_APPLICATION_CREDENTIALS at a service-account JSON file.',
  );
}

/**
 * Initialize and return the firebase-admin app/firestore using the resolved
 * credentials. Idempotent.
 */
export async function initAdmin() {
  const admin = (await import('firebase-admin')).default;
  if (!admin.apps.length) {
    const { projectId, clientEmail, privateKey } = resolveServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
  }
  return admin;
}

/**
 * Mint a Google OAuth2 access token from the resolved service account, for
 * calling Google REST APIs directly (e.g. firebaserules.googleapis.com).
 */
export async function getAccessToken(scopes = ['https://www.googleapis.com/auth/cloud-platform']) {
  const { GoogleAuth } = await import('google-auth-library');
  const { projectId, clientEmail, privateKey } = resolveServiceAccount();
  const auth = new GoogleAuth({
    scopes,
    credentials: { client_email: clientEmail, private_key: privateKey },
    projectId,
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain an access token from the service account.');
  return { token, projectId };
}
