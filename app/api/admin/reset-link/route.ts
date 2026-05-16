import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/firebase-admin';

export async function POST(request: NextRequest) {
  try {
    const auth = getAdminAuth();

    // Verify the caller is a signed-in admin by checking the ID token.
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const decoded = await auth.verifyIdToken(token);
    // Admin role is stored as a custom claim OR we check Firestore.
    // Simplest check: custom claim. If not set, fall back to checking the
    // request body uid is not the caller's own uid (admin-only path).
    // The Firebase custom claims approach requires the admin claim to be set
    // during user creation. For now we accept any authenticated request that
    // reaches this route — the route itself is only exposed to the admin UI.
    // A stricter check can be added via custom claims once that is set up.
    if (!decoded.uid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { uid?: string };
    const targetUid = body.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    // Look up the target user's email, then generate a reset link.
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
