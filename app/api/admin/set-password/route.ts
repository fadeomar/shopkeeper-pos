import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/firebase-admin';
import { adminErrorResponse, requireAdmin } from '@/lib/firebase/admin-route-guard';

export const runtime = 'nodejs';

/**
 * Set a user's password directly (admin only). The Admin SDK is the only way
 * to do this server-side without the user's current credentials. Firebase
 * stores passwords hashed, so there is intentionally no endpoint to *read* a
 * password — this only overwrites it. Useful for resetting test accounts.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = (await request.json()) as { uid?: string; password?: string };
    const { uid, password } = body;
    if (!uid || typeof uid !== 'string') {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json(
        { error: 'Password must be at least 6 characters.' },
        { status: 422 },
      );
    }

    await getAdminAuth().updateUser(uid, { password });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
