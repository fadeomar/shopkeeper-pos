import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebase/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const auth = getAdminAuth();

    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = await auth.verifyIdToken(token);

    // Verify the caller is an admin by reading their Firestore user doc.
    // Role is stored at users/{uid}.role — set during createAppUser/registerUser.
    const callerDoc = await getAdminFirestore().doc(`users/${decoded.uid}`).get();
    if (!callerDoc.exists || (callerDoc.data() as { role?: string } | undefined)?.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json() as { uid?: string };
    const targetUid = body.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    const targetUser = await auth.getUser(targetUid);
    if (!targetUser.email) {
      return NextResponse.json(
        { error: 'This user has no email address set in Firebase Auth.' },
        { status: 422 },
      );
    }

    const link = await auth.generatePasswordResetLink(targetUser.email);
    return NextResponse.json({ link });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
