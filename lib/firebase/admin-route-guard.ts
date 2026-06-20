import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  FirebaseAdminConfigurationError,
  getAdminAuth,
  getAdminFirestore,
} from './firebase-admin';

/**
 * Thrown when an admin API request fails authentication/authorization.
 * `status` is the HTTP status the route should return.
 */
export class AdminRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'AdminRequestError';
  }
}

/**
 * Verify that a request to an /api/admin/* route is made by an active admin.
 *
 * The caller must present a Firebase ID token as `Authorization: Bearer <token>`.
 * We verify the token, then read their /users/{uid} profile and require the
 * admin-capable role ('administration', or legacy 'admin') AND an active account — the
 * same gate enforced by isActiveAdmin() in firestore.rules. Returns the
 * verified caller uid so routes can guard self-targeting actions.
 *
 * Throws AdminRequestError on any failure; routes map it via adminErrorResponse.
 */
export async function requireAdmin(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new AdminRequestError(401, 'Unauthorized');

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    throw new AdminRequestError(401, 'Unauthorized');
  }

  const callerDoc = await getAdminFirestore().doc(`users/${uid}`).get();
  const data = callerDoc.data() as { role?: string; isActive?: boolean } | undefined;
  const isAdminRole = data?.role === 'administration' || data?.role === 'admin';
  if (!callerDoc.exists || !isAdminRole || data?.isActive === false) {
    throw new AdminRequestError(403, 'Forbidden');
  }
  return uid;
}

/**
 * Map an error thrown while handling an admin route to a JSON response.
 *   - Missing/invalid admin credentials -> 503 (server not configured)
 *   - AdminRequestError -> its own status (401/403/400/…)
 *   - anything else -> 500
 */
export function adminErrorResponse(err: unknown): NextResponse {
  if (err instanceof FirebaseAdminConfigurationError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  if (err instanceof AdminRequestError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Unknown error';
  return NextResponse.json({ error: message }, { status: 500 });
}
