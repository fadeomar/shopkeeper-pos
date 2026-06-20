# Sprint: Production Permissions

## Goal
Make the existing role system effective in production without changing the cashier's daily workflow or adding new roles.

## Implemented

### 1. Central permission engine
Added `lib/permissions/permission-engine.ts` with granular app permissions such as:

- `sales.create`
- `sales.void`
- `sales.return`
- `products.edit`
- `products.editCost`
- `purchases.create`
- `reports.view`
- `settings.manage`
- `roles.manage`

The engine maps the existing roles (`owner`, `cashier`, `manager`, `accountant`) to app-level permissions while preserving the current cashier behavior.

### 2. Route-level protection
Added `components/auth/route-permission-gate.tsx` and wired it inside `CashierShell`.

This means restricted pages now show an access-denied screen instead of rendering the workspace when the current role is not allowed.

Protected examples:

- `/billing` requires `sales.create`
- `/purchases/new` requires `purchases.create`
- `/reports` requires `reports.view`
- `/settings` requires `settings.manage` or `roles.manage`

### 3. Navigation-level protection
Updated:

- `components/sidebar-nav.tsx`
- `components/mobile-bottom-nav.tsx`

Navigation now hides pages the current role cannot access. This is only UX protection; the route gate remains the real page-level backstop.

### 4. Service/action-level protection
Extended `lib/services/permission-service.ts` with `assertAppPermission()`.

Applied it to product writes:

- `createProductWithInitialMovement()` → `products.create`
- `updateProductDetails()` → `products.edit`

Existing high-risk guards remain active:

- discounts → `canDiscount`
- void sale → `canVoid`
- sale return → `canReturn`
- cost edits/loss-sale paths → `canEditCost`
- settings writes → `canManageSettings`
- role-permission matrix writes → `canManageRolePermissions`

### 5. Unit tests
Added `tests/unit/domain/app-permissions.test.ts` covering:

- cashier keeps current operational access
- accountant gets read/report access but not operational writes
- unknown role fails closed
- role overrides affect action-level permissions

## Current production behavior target

### Cashier
- Can continue current POS flow.
- Can create sales, manage products, purchases, shift/cash/expenses/settings according to the existing current-role model.

### Manager
- Operational access, but cost/settings escalation remains restricted by the existing role-permission defaults.

### Accountant
- Read/report-oriented access.
- Cannot create sales or purchases.
- Cannot edit products.

### Owner
- Remains admin/user-management role through the admin shell.

## Local verification
Run:

```bash
npm install
npm run typecheck
npm run test:unit -- tests/unit/domain/app-permissions.test.ts
npm run verify:rules
npm run build
```

## Notes
This sprint intentionally does not add supervisor/multi-store dashboard behavior. It hardens the current roles first so the existing codebase has a safe production base before adding cross-store supervision.
