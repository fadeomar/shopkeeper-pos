# Offline Trusted Auth Session QA

This checklist validates the 30-day trusted-device login flow. It must be run against a clean browser profile or after clearing site data.

## Scenario A — first login must be online

1. Clear site data.
2. Turn off internet.
3. Open the app.
4. Try to sign in.
5. Expected: the login screen shows a clear message that the first sign-in on this device requires internet.

## Scenario B — 30-day offline session boot

1. Clear site data.
2. Go online.
3. Log in successfully.
4. Confirm Dashboard/Billing loads.
5. Close the tab or installed PWA.
6. Turn off internet.
7. Reopen the app.
8. Expected: the app opens without showing Login, using the cached trusted session.
9. Create a sale offline.
10. Refresh while still offline.
11. Expected: still authenticated and the sale remains saved locally.

## Scenario C — reconnect validation and sync

1. Continue from Scenario B.
2. Reconnect internet.
3. Expected: Firebase/Firestore validation refreshes the trusted session.
4. Expected: pending sync queue flushes normally.

## Scenario D — explicit logout blocks offline auto-login

1. Log in online.
2. Click Sign out and confirm.
3. Close the app.
4. Turn off internet.
5. Reopen the app.
6. Expected: the app shows Login and does not boot from `authCache`, `shopkeeper_active_uid`, or account vault alone.

## Scenario E — expired session

1. Log in online.
2. Manually edit `shopkeeper_trusted_auth_session_v1.expiresAt` in localStorage to a date older than now.
3. Turn off internet.
4. Reopen the app.
5. Expected: the app shows Login with the expired-session message.

## Scenario F — account disabled online after offline period

1. Log in online as an active user.
2. Go offline and open the app from the saved session.
3. In Firestore/admin, disable the user or expire the subscription.
4. Reconnect.
5. Expected: online validation updates the cached profile and moves the UI to inactive/subscription-expired.
