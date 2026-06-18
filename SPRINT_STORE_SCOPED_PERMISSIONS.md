# Store-scoped permissions groundwork

This sprint starts the multi-user / multi-device permission model without changing the cashier flow.

## Implemented

- Added `storeId` and `storeRole` to `AppUser`.
- Added `resolveStoreId(user)` helper:
  - legacy accounts with no `storeId` continue to use `uid` as the store scope.
  - new staff accounts inherit the creator/admin store scope.
- Admin-created users now save:
  - `role`
  - `storeRole`
  - `storeId`
- Self-registered trial users now get `storeId = uid`.
- Local Dexie handoff now separates:
  - active signed-in user id
  - active business/store id
- Sync/restore/startup decisions now use the store scope, so multiple users of the same store can target the same cloud business data.
- Firestore rules were updated so active store members can read/write POS subcollections under their assigned `storeId`, while profile data remains per-login.

## What this means

The current cashier flow remains the same:

1. Admin creates a user.
2. User signs in with email/password.
3. User works as cashier/manager/accountant based on role.
4. POS data syncs under the shared store scope instead of being trapped under that cashier's personal uid.

Legacy single-user accounts still work because missing `storeId` falls back to the account `uid`.

## Still recommended next

- Add UI in admin user details showing `storeId` / store scope.
- Add tests for:
  - cashier can write `users/{storeId}/bills`
  - cashier cannot write another store
  - manager/accountant permissions are enforced in UI + services
- Decide whether `owner` should become a store operator role or remain support/admin-only.

## Validation note

A full local typecheck/build needs dependencies installed. In this environment `node_modules` was not present. Run locally:

```bash
npm install
npm run typecheck
npm run verify:rules
npm run build
```
