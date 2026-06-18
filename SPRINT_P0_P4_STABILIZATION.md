# Sprint P0-P4 Stabilization

This sprint stabilizes the multi-user/offline permissions work after code review.

## P0 — Build/typecheck blockers

- Fixed `settings.rolePermissions` indexing for the `administration` role in:
  - `lib/hooks/use-permissions.ts`
  - `lib/services/permission-service.ts`
- Fixed TypeScript narrowing for auto conflict resolution inside the Dexie transaction in:
  - `lib/services/sync-conflict-service.ts`
- Fixed cashier `reports.view` permission leak in:
  - `lib/permissions/permission-engine.ts`
- Added i18n keys for route permission denial in:
  - `components/auth/route-permission-gate.tsx`
  - `lib/i18n/en.ts`
  - `lib/i18n/ar.ts`
  - `lib/i18n/types.ts`

## P1 — Migration and owner bootstrap

- Self-registration now creates the first store user as:
  - `role: owner`
  - `storeRole: owner`
  - `storeId: uid`
- Firestore self-registration rules now enforce the owner trial shape.
- Added `scripts/plan-permissions-migration.mjs` and npm script:
  - `npm run plan:permissions-migration`
- The migration script dry-runs existing stores and promotes one active legacy cashier/manager to `owner` per store only when:
  - `APPLY_PERMISSIONS_MIGRATION=1`

## P2 — Reports permissions

- Cashiers can no longer access `reports.view`.
- Reports are limited to:
  - `owner`
  - `manager`
  - `accountant`
  - `administration`

## P3 — Conflict engine behavior

- Non-user-visible deferred conflicts are no longer stored as `open` conflicts.
- Safe/quiet conflicts are stored as ignored review records, so they do not trigger the resolver modal.
- Critical defer conflicts still remain open for owner review.

## P4 — Inventory/sequence safety foundation

- Additive business records such as bills and stock movements stay `keep_both`.
- Settings sequence conflicts now merge using the maximum sequence value instead of arbitrary last-writer-wins.
- This avoids the sequence counter moving backward after two offline devices reconnect.

## Verification performed in this environment

Passed:

```bash
npm run typecheck
npm run verify:rules
npx vitest run tests/unit/domain/app-permissions.test.ts tests/unit/domain/role-permissions.test.ts tests/unit/domain/auto-conflict-policy.test.ts --reporter dot --pool=forks --maxWorkers=1
```

Build note:

`next build` compiled successfully, then the sandbox execution timed out during the later build/type validation phase. Because `npm run typecheck` passed separately, run the full build locally before promoting to staging.

## Recommended local verification

```bash
npm install
npm run typecheck
npm run verify:rules
npx vitest run tests/unit/domain/app-permissions.test.ts tests/unit/domain/role-permissions.test.ts tests/unit/domain/auto-conflict-policy.test.ts --reporter dot --pool=forks --maxWorkers=1
npm run build
```

## Production caution

Before production deploy:

1. Run `npm run plan:permissions-migration` as dry-run against Firestore.
2. Review the promotions list.
3. Apply with `APPLY_PERMISSIONS_MIGRATION=1` only after backup/export.
4. Manually ensure your internal support account has `role: administration`.
5. Deploy app and Firestore rules together.
