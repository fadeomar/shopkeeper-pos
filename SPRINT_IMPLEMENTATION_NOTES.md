# Asas POS — Sprint Quality Implementation Notes

This updated package applies practical code changes from the sprint quality review strategy.

## Implemented in this package

### 1. Mobile data-table fallback

- `components/ui/data-table.tsx` now renders a mobile card/list layout under `md` screens.
- Desktop keeps the full TanStack table.
- The mobile fallback shows the primary cell, key details, and action controls without requiring horizontal scrolling.
- DataTable now supports optional tappable mobile rows via:
  - `getMobileRowHref`
  - `getMobileRowAriaLabel`

### 2. Purchase history mobile drill-down

- `features/purchases/components/purchase-history.tsx` now passes a mobile row href to open purchase details.
- The purchase number cell was changed from an inline anchor to a text cell so the full mobile card can safely be tappable.

### 3. Purchase-entry desktop input stability

- `features/purchases/components/purchase-entry-screen.tsx` now memoizes purchase draft table columns.
- `updateLine` and `removeLine` are stable callbacks.
- This reduces the risk of editable quantity/cost cells remounting while users type on desktop purchase tables.

### 4. Numeric input wheel behavior

- `components/ui/number-field.tsx` no longer blurs the input on mouse wheel/trackpad scroll.
- It prevents and stops the wheel event while focused, avoiding accidental value changes without making the field feel like it lost focus.

### 5. Mobile More menu organization

- `components/mobile-bottom-nav.tsx` now groups More menu links into:
  - Daily work
  - Business
  - Reports
  - System
- Added Arabic and English translations for those group labels.

## Already present and preserved

The project already had several sprint-aligned protections before this patch, including:

- Demo-data UI behind a feature flag.
- Role-permission UI behind `NEXT_PUBLIC_ENABLE_ROLE_PERMISSIONS`.
- Offline/PWA route warm-up and cache readiness status.
- Sync queue pending status badge.
- Weight-product helpers that calculate price-per-kg from gram-based stock correctly.

## Verification note

This ZIP did not include `node_modules`, so full `npm run typecheck` / test execution could not be completed inside the sandbox without installing dependencies. A whitespace/syntax diff check was completed with `git diff --check` for the changed files.

Recommended local verification after extracting:

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:components
npm run build
```

Recommended manual checks:

1. Open `/purchases/new` on desktop and type quickly in quantity/cost cells.
2. Scroll the page while a NumberField/MoneyInput is focused.
3. Open `/purchases` on mobile width and tap a purchase card.
4. Open customers/suppliers/cash/expenses/audit on mobile width and verify no horizontal scroll is needed for core reading.
5. Open the mobile More sheet and confirm the grouped structure is clear.
