import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase/firebase-admin';
import { adminErrorResponse, requireAdmin } from '@/lib/firebase/admin-route-guard';

export const runtime = 'nodejs';

/**
 * Permanently delete a user: their Firestore profile doc AND every POS
 * subcollection under it (bills, products, stockMovements, …), plus their
 * Firebase Auth sign-in. This is irreversible — the client requires a
 * type-the-email confirmation before calling it.
 */
export async function POST(request: NextRequest) {
  try {
    const callerUid = await requireAdmin(request);

    const body = (await request.json()) as { uid?: string };
    const targetUid = body.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }
    // Never let an admin delete the account they're signed in with — it would
    // orphan their own session and they'd lock themselves out mid-action.
    if (targetUid === callerUid) {
      return NextResponse.json(
        { error: 'You cannot delete the account you are signed in with.' },
        { status: 400 },
      );
    }

    const db = getAdminFirestore();
    // recursiveDelete removes the profile doc and all nested subcollections.
    await db.recursiveDelete(db.doc(`users/${targetUid}`));

    // Remove the Auth user too. Tolerate an already-missing record so a
    // half-deleted account (Firestore present, Auth gone) can still be cleaned.
    try {
      await getAdminAuth().deleteUser(targetUid);
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
