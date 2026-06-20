# Sprint: Multi-User Offline Permissions

## Goal
Move the app from a single-user-oriented POS into a safer multi-user, store-scoped, offline-first POS without changing the daily cashier flow.

## Implemented in this package

### 1. Role model cleanup
- Added `administration` as the app-level/system administration role.
- Repositioned `owner` as the highest customer-side role inside one store.
- Kept existing store roles: `owner`, `manager`, `cashier`, `accountant`.
- Updated the authenticated shell so only `administration` enters the global admin shell; `owner` now stays in the store/POS shell.
- Updated admin API/rules guard so global admin endpoints require `administration` or legacy `admin`, not store `owner`.

### 2. Production permission matrix
- Owner: full access inside their store, including users/settings/products/reports.
- Manager: daily operations, products, inventory, purchases, reports; no users/settings.
- Cashier: sales, returns, shifts; no catalog/admin/settings/financial reports.
- Accountant: read/report-oriented access; no operational writes.
- Administration: internal app-level role with system permissions.

### 3. Settings role permissions
- Role permissions card now includes `owner` as a fixed full-store role.
- `administration` is intentionally excluded from store-level role overrides.
- Meta permissions remain non-overridable to prevent local IndexedDB tampering from escalating a user.

### 4. Auto conflict policy foundation
Added `lib/sync/auto-conflict-policy.ts` with explicit decisions:
- Additive records like bills, stock movements, payments, audit events: `keep_both` without user interruption.
- Non-inventory product fields: auto `merge` without conflict UI.
- Sequence fields: auto `merge`.
- Direct product quantity conflicts: deferred until stock movement delta checks prove safety.
- Delete/update and sale state conflicts: deferred for owner review, only critical cases should surface.

### 5. Sync conflict service integration
- `saveConflict()` now consults the auto conflict policy.
- Safe auto-resolved conflicts are stored as `ignored` with a resolution instead of becoming noisy open conflicts.
- For safe product/settings merges, the local row is kept `pending` so the merged result can sync up.

### 6. Tests added/updated
- `tests/unit/domain/app-permissions.test.ts`
- `tests/unit/domain/role-permissions.test.ts`
- `tests/unit/domain/auto-conflict-policy.test.ts`

## Migration note
Existing customer store accounts that were previously using role `owner` should now be treated as store owners and will enter the normal store POS shell. Your internal/global admin account should be set to role `administration` before relying on the global `/admin` area.

## Local verification
Run locally after installing dependencies:

```bash
npm install
npm run typecheck
npm run test:unit -- tests/unit/domain/app-permissions.test.ts tests/unit/domain/role-permissions.test.ts tests/unit/domain/auto-conflict-policy.test.ts
npm run verify:rules
npm run build
```

## What is intentionally still not implemented
- A full multi-store supervisor dashboard.
- Manual conflict review redesign.
- Server-side inventory event compaction.
- A data migration script that bulk converts historical global admin users from `owner` to `administration`.

Those should be separate production hardening tasks after local testing confirms the new role split.
