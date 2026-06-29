import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/components/providers/auth-context';
import { LocaleProvider } from '@/components/providers/locale-context';
import { ToastProvider } from '@/components/ui/toast';
import { db } from '@/lib/db/schema';
import { rememberTrustedSession, TRUSTED_SESSION_STORAGE_KEY } from '@/lib/services/local-auth-session-service';
import { resetTestDb } from '@/tests/helpers/db';
import type { AppUser, AuthCacheEntry } from '@/types/domain';

const authMocks = vi.hoisted(() => {
  let callback: ((user: { uid: string } | null) => Promise<void> | void) | null = null;
  return {
    setCallback: (next: ((user: { uid: string } | null) => Promise<void> | void) | null) => { callback = next; },
    emit: async (user: { uid: string } | null) => { await callback?.(user); },
    onAuthChange: vi.fn(),
    fetchUserDoc: vi.fn(),
    signOut: vi.fn(),
    unsubscribe: vi.fn(),
  };
});

vi.mock('@/lib/firebase/auth-service', () => ({
  onAuthChange: authMocks.onAuthChange.mockImplementation((callback: (user: { uid: string } | null) => Promise<void> | void) => {
    authMocks.setCallback(callback);
    return authMocks.unsubscribe;
  }),
  fetchUserDoc: authMocks.fetchUserDoc,
  signOut: authMocks.signOut,
}));

function makeUser(overrides: Partial<AuthCacheEntry> = {}): AuthCacheEntry {
  const now = '2026-01-01T00:00:00.000Z';
  return {
    uid: 'uid-offline',
    email: 'cashier@example.test',
    name: 'Cashier',
    role: 'cashier',
    isActive: true,
    pendingApproval: false,
    createdAt: now,
    accountType: 'standard',
    subscriptionStatus: 'active',
    subscriptionStartAt: now,
    subscriptionEndAt: '2027-01-01T00:00:00.000Z',
    subscriptionEndAtMs: Date.parse('2027-01-01T00:00:00.000Z'),
    cachedAt: now,
    ...overrides,
  };
}

function AuthProbe() {
  const { status, user, authError, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="uid">{user?.uid ?? 'none'}</p>
      <p data-testid="auth-error">{authError}</p>
      <button type="button" onClick={() => void logout()}>logout</button>
    </div>
  );
}

function renderAuthProvider() {
  return render(
    <LocaleProvider>
      <ToastProvider>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </ToastProvider>
    </LocaleProvider>,
  );
}

describe('AuthProvider offline trusted session', () => {
  beforeEach(async () => {
    authMocks.onAuthChange.mockClear();
    authMocks.fetchUserDoc.mockReset();
    authMocks.signOut.mockReset();
    authMocks.unsubscribe.mockReset();
    authMocks.setCallback(null);
    await resetTestDb();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('keeps the user authenticated from a valid trusted session when Firebase returns null', async () => {
    const user = makeUser({ uid: 'uid-cached' });
    await rememberTrustedSession(user, new Date());

    renderAuthProvider();
    await act(async () => { await authMocks.emit(null); });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('uid-cached');
    });
  });

  it('shows login and an expired-session message when Firebase returns null and the trusted session expired', async () => {
    await rememberTrustedSession(makeUser({ uid: 'uid-expired' }), new Date('2026-01-01T00:00:00.000Z'));

    renderAuthProvider();
    await act(async () => { await authMocks.emit(null); });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('auth-error')).toHaveTextContent('expired');
    });
  });

  it('refreshes the trusted session after a successful online Firestore validation', async () => {
    const onlineUser: AppUser = makeUser({ uid: 'uid-online', cachedAt: 'unused' });
    authMocks.fetchUserDoc.mockResolvedValue(onlineUser);

    renderAuthProvider();
    await act(async () => { await authMocks.emit({ uid: 'uid-online' }); });

    await waitFor(async () => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('uid-online');
      expect(window.localStorage.getItem(TRUSTED_SESSION_STORAGE_KEY)).toContain('uid-online');
      await expect(db.authCache.get('uid-online')).resolves.toMatchObject({ uid: 'uid-online' });
    });
  });

  it('clears the trusted session on explicit logout', async () => {
    await rememberTrustedSession(makeUser({ uid: 'uid-logout' }), new Date());

    renderAuthProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    await userEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => {
      expect(authMocks.signOut).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem(TRUSTED_SESSION_STORAGE_KEY)).toBeNull();
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
  });

  it('boots from a valid trusted session on mount even before Firebase responds', async () => {
    const user = makeUser({ uid: 'uid-timeout' });
    await rememberTrustedSession(user, new Date());

    renderAuthProvider();

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('uid-timeout');
    });
  });

  it('uses the trusted cache for the same uid when Firestore validation fails offline', async () => {
    const user = makeUser({ uid: 'uid-firestore-down' });
    await rememberTrustedSession(user, new Date());
    authMocks.fetchUserDoc.mockRejectedValue(new Error('offline'));

    renderAuthProvider();
    await act(async () => { await authMocks.emit({ uid: 'uid-firestore-down' }); });

    await waitFor(() => {
      expect(authMocks.fetchUserDoc).toHaveBeenCalledWith('uid-firestore-down');
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('uid-firestore-down');
    });
  });

  it('does not show the offline-session toast when the session validates online', async () => {
    const user = makeUser({ uid: 'uid-online-toast' });
    await rememberTrustedSession(user, new Date());
    authMocks.fetchUserDoc.mockResolvedValue(makeUser({ uid: 'uid-online-toast' }));

    renderAuthProvider();
    await act(async () => { await authMocks.emit({ uid: 'uid-online-toast' }); });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('uid-online-toast');
    });
    // The optimistic boot must stay silent; online validation succeeded, so the
    // "restored from saved session" notice must never appear.
    expect(screen.queryByText(/saved session/i)).not.toBeInTheDocument();
  });

  it('shows the offline-session toast only when online validation genuinely fails', async () => {
    const user = makeUser({ uid: 'uid-offline-toast' });
    await rememberTrustedSession(user, new Date());
    authMocks.fetchUserDoc.mockRejectedValue(new Error('offline'));

    renderAuthProvider();
    await act(async () => { await authMocks.emit({ uid: 'uid-offline-toast' }); });

    await waitFor(() => {
      expect(screen.getByText(/saved session/i)).toBeInTheDocument();
    });
  });

  it('does not restore from authCache alone when trusted session metadata is missing', async () => {
    await db.authCache.put(makeUser({ uid: 'uid-cache-only' }));

    renderAuthProvider();
    await act(async () => { await authMocks.emit(null); });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('uid')).toHaveTextContent('none');
    });
  });

});
