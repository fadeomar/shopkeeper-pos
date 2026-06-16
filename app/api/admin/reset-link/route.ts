import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebase/firebase-admin';
import { adminErrorResponse, requireAdmin } from '@/lib/firebase/admin-route-guard';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = await request.json() as { uid?: string };
    const targetUid = body.uid;
    if (!targetUid || typeof targetUid !== 'string') {
      return NextResponse.json({ error: 'uid is required' }, { status: 400 });
    }

    const auth = getAdminAuth();
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
    return adminErrorResponse(err);
  }
}
