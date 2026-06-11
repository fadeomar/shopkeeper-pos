import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

type FirebaseAdminConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export class FirebaseAdminConfigurationError extends Error {
  constructor(message = 'Firebase Admin is not configured on this server.') {
    super(message);
    this.name = 'FirebaseAdminConfigurationError';
  }
}

function normalizePrivateKey(value?: string): string | undefined {
  if (!value) return undefined;

  // Vercel and local .env files often store the key on one line with escaped
  // newlines. Some dashboards also wrap the value in quotes. Support both.
  const unquoted = value.trim().replace(/^['"]|['"]$/g, '');
  return unquoted.replace(/\\n/g, '\n');
}

function getPrivateKeyFromEnv(): string | undefined {
  const rawPrivateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY);
  if (rawPrivateKey) return rawPrivateKey;

  // Optional safer/easier deployment format: base64-encode the private key and
  // store it as FIREBASE_ADMIN_PRIVATE_KEY_BASE64 to avoid multiline escaping
  // mistakes in hosting dashboards.
  const base64Key = process.env.FIREBASE_ADMIN_PRIVATE_KEY_BASE64?.trim();
  if (!base64Key) return undefined;

  try {
    return Buffer.from(base64Key, 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

function getAdminConfig(): FirebaseAdminConfig {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = getPrivateKeyFromEnv();

  if (!projectId || !clientEmail || !privateKey) {
    throw new FirebaseAdminConfigurationError(
      'Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, and FIREBASE_ADMIN_PRIVATE_KEY or FIREBASE_ADMIN_PRIVATE_KEY_BASE64 in your environment.',
    );
  }

  return { projectId, clientEmail, privateKey };
}

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]!;

  const { projectId, clientEmail, privateKey } = getAdminConfig();
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminFirestore() {
  return getFirestore(getAdminApp());
}
