# Design refactor sprint — Step 1 delivery

This document covers what landed in this first chunk and what comes next.
The work is sequenced so each step is independently shippable and
reviewable. Nothing here changes business logic, schemas, routes,
translations, or offline behavior — per the rules in `DESIGN_SYSTEM.md`.

## What this chunk changes

### 1. Typography (`app/layout.tsx`)
Loaded three self-hosted fonts via `next/font/google` — Plus Jakarta Sans
(Latin UI), IBM Plex Sans Arabic (Arabic UI), and JetBrains Mono (prices,
codes, receipts). They're exposed as CSS variables (`--font-sans`,
`--font-arabic`, `--font-mono`) and attached to `<html>` via Tailwind v4's
`className` prop. Offline-first: `next/font` inlines fonts at build time,
so once the PWA is cached no network is needed. System fallbacks remain at
the end of every stack so the app is still usable if Google's CDN is
unreachable on the very first load.

The `:lang(ar)` selector in `globals.css` swaps Arabic to use Plex Sans
Arabic as its primary, so the existing locale-switch flow keeps working
unchanged.

### 2. Color tokens as CSS variables (`app/globals.css`)
The full token set from `lib/design/tokens.ts` is now exposed as CSS
custom properties under `:root` and mapped into Tailwind v4's color
system via the `@theme inline` block. New utility colors available:

- Surfaces: `bg-app`, `bg-surface`, `bg-surface-soft`, `bg-surface-muted`
- Text: `text-fg`, `text-fg-secondary`, `text-fg-muted`, `text-fg-inverse`
- Borders: `border-subtle`, `border-default`, `border-strong`
- Brand: `bg-brand`, `bg-brand-soft`, `text-brand`, `border-brand`
- Status: `bg-success`, `bg-success-soft`, `text-success` … same for
  `warning`, `danger`, `info`

Migration is opportunistic: existing `bg-slate-*` / `text-slate-*`
classes still work and can be swapped over time. Don't bulk-replace
yet — we want per-page review to make sure semantic meaning is preserved.

Brand color updated from `#2563eb` (stock blue-600) to `#1e57e8`, a
slightly deeper, more confident blue. Soft, hover, and ring variants
recalibrated to match.

### 3. Number-input CSS conflict fixed (`app/globals.css`)
The old rule was:
```css
input[type="number"] { direction: ltr; text-align: right; }
```
The `text-align: right` was silently overriding every `className="text-center"`
override across the app (e.g. inside QuantityStepper). Removed
`text-align: right` from the base rule. Direction stays LTR for digit
order in Arabic mode. Webkit spinner buttons are hidden, and
`-moz-appearance: textfield` removes them in Firefox.

### 4. `NumberField` component (`components/ui/number-field.tsx`)
The new POS-grade numeric input. Replaces `<Input type="number">`
across the app. Key behaviors:

- `type="text"` + `inputMode` — best mobile keyboard, no spinner, no
  scroll-wheel mutation
- Internal string buffer so backspace-to-empty works (parent only gets
  numeric updates on valid input + blur)
- Accepts `.` or `,` as decimal separator
- Normalizes Arabic-Indic and Eastern-Arabic digit characters
- `precision="integer" | "decimal"` + `decimalScale` for rounding control
- Optional inline `+/-` stepper (replaces three-piece QuantityStepper layout)
- `prefix` / `suffix` slots for currency or unit labels
- ArrowUp/Down step the value; wheel-scroll is suppressed
- Auto-selects on focus (cashier-friendly: tap → type)
- `min` / `max` clamping on commit (not while typing — would block
  typing "0.5" if min is 1)

API matches the existing `Input` size/error/fullWidth props so migration
is mechanical.

### 5. `QuantityStepper` migrated (`components/pos/quantity-stepper.tsx`)
Now a thin wrapper around `NumberField` with `showStepper precision="integer" align="center"`.
Public API unchanged — every caller works as before.

### 6. Icons (`components/ui/icons.ts`)
Added `lucide-react` to dependencies. Curated re-export of the ~60 icons
the app will use. Bundle is tree-shaken — only imported icons are shipped.

### 7. Utilities added (`app/globals.css`)
- `.focus-ring` — soft brand-colored 3px ring for focused controls
- `.pb-safe` / `.pt-safe` — iOS safe-area aware padding
- `.animate-sheet-up`, `.animate-fade-in`, `.animate-pop-in` — for the
  upcoming bottom-sheet modal and dropdown panel transitions
- Default `tabular-nums` applied to `.tabular-nums`, `[data-numeric]`,
  and every numeric `<input>` — POS values now align in columns
  everywhere by default

## What's next (in order)

| Step | Scope | Risk | Why next |
|------|-------|------|----------|
| 3 | Upgrade `SearchableSelect` — portal panel, mobile bottom-sheet behavior, lucide chevron + check icons, fix iOS keyboard interaction | Low | Touches 10 call sites; current component is the foundation |
| 4 | Convert `Modal` to bottom-sheet on mobile (centered on desktop, sheet on `<sm`) via new `presentation` prop with mobile-default | Low | Affects every modal call site for free |
| 5 | Migrate remaining 36 `<Input type="number">` usages to `NumberField` (mechanical: replace tag, drop type, add precision/decimalScale, pass `onValueChange` instead of register) | Med | High-leverage UX fix per call site |
| 6 | Replace the native `<Select>` in Settings tax mode + 2 audit filters with `SearchableSelect` | Low | Consistency |
| 7 | Sidebar icons + active-state polish | Low | Visible improvement, contained |
| 8 | Replace text symbols with icons where icons win (modal X close, dropdown chevrons, +/- stepper, sidebar nav, page-header actions, scan/print buttons). Keep `?` for help, `←/→` for next-action arrows. | Low | Surgical |
| 9 | Per-page polish — dashboard stat cards, POS sticky checkout bar, success panel, low-stock warning | Med | Last pass, page-by-page |

## Migration recipe for number inputs

For mechanical search-and-replace:

```tsx
// BEFORE
<Input
  type="number"
  inputMode="decimal"
  step="0.01"
  {...form.register("buyPrice", { valueAsNumber: true })}
/>

// AFTER
<NumberField
  value={form.watch("buyPrice")}
  onValueChange={(v) => form.setValue("buyPrice", v, { shouldDirty: true, shouldValidate: true })}
  precision="decimal"
  decimalScale={2}
/>
```

For currency, add `prefix={currencySymbol}`.
For quantity inside cart rows, add `showStepper precision="integer" align="center"`.
For form-bound react-hook-form fields, use `Controller` to keep the
form state authoritative — or the watch/setValue pattern above for
simpler cases.

## Caveats / known limitations

- `NumberField` is a controlled component only. There's no
  `defaultValue` path — for uncontrolled usage callers should use
  `useState` to bridge.
- `react-hook-form` integration via `register` won't work directly
  (because we don't use `onChange`). Either use `Controller` or the
  `watch`/`setValue` pattern shown above.
- The `has-[input:focus]` Tailwind variant requires modern Chromium /
  Safari / Firefox (~2023+). Older browsers won't get the highlighted
  focus ring but the field is still fully usable.

---

# Phase 1 — Token & palette migration

## What this chunk changes

Switched the entire visual palette from blue-brand to retail-POS green. All changes flow through CSS variables — no per-component logic was touched.

### 1. Green brand palette (`app/globals.css`, `lib/design/tokens.ts`)
`--color-brand` changed from `#1e57e8` (blue) to `#1F6F43` (forest green). Surface and border variables gained a warm green tint (`--color-app: #F6F7F2`, borders now `#DDE3D4`, etc.). Success was shifted from a dark green to a brighter `#059669` so it stays visually distinct from the brand. Info stayed blue (`#2563EB`) — links and info badges intentionally use a different hue from the brand. Added `--color-money: #B7791F` and `--color-money-soft: #FEF3C7` for cash/revenue accents. Both files stay in lockstep.

### 2. Shared UI primitives
- `button.tsx`: `primary` → `bg-brand/hover:bg-brand-hover`, `soft` → `bg-brand-soft text-brand`, `success` → `bg-success`, `warning` → `bg-warning-soft text-warning`, `link` → `text-info`, focus ring → `ring-brand`.
- `input.tsx` / `select.tsx`: focus ring `ring-blue-500` → `ring-brand`.
- `loading-state.tsx`: spinner `border-blue-600` → `border-brand`.

### 3. Navigation
- Sidebar active bar: `bg-blue-400` → `bg-brand`.
- Sidebar active icon: `text-blue-300` → `text-white/80` (green `#1F6F43` is too dark to read on the dark sidebar chrome).
- Shift dot: `bg-emerald-400` → `bg-success` (both mobile and desktop).

### 4. Triage of raw color literals
All `blue-*` primary actions → brand tokens. All `blue-*` info/link contexts → `text-info` / `bg-info-soft`. All `emerald-*` → success tokens. All `amber-*` → warning tokens. Files updated: `authenticated-shell.tsx`, `sync-status-badge.tsx`, `conflict-resolver-modal.tsx`, `reports-workspace.tsx`, `inventory-workspace.tsx`, `products-table.tsx`, `bills-table.tsx`, `audit-workspace.tsx`, `customer-ledger-workspace.tsx`, `supplier-ledger-workspace.tsx`, `purchase-entry-screen.tsx`, `bill-details.tsx`, `cash-workspace.tsx`, `shift-workspace.tsx`, `shift-report.tsx`, `product-form.tsx`, `z-report.tsx`, `app/page.tsx`, `app/settings/page.tsx`, `app/bills/[billId]/page.tsx`.

### 5. Documentation
`DESIGN_SYSTEM.md` §3 rewritten with the full palette table and color-use rules.

## Pre-existing typecheck issue (not introduced)
`features/inventory/components/inventory-workspace.tsx:366` — `quantity.trim()` TypeScript error existed before this phase.

## Files changed

```
M  app/globals.css
M  lib/design/tokens.ts
M  components/ui/button.tsx
M  components/ui/input.tsx
M  components/ui/select.tsx
M  components/ui/loading-state.tsx
M  components/sidebar-nav.tsx
M  components/auth/authenticated-shell.tsx
M  components/sync/sync-status-badge.tsx
M  components/sync/conflict-resolver-modal.tsx
M  features/reports/components/reports-workspace.tsx
M  features/inventory/components/inventory-workspace.tsx
M  features/products/components/products-table.tsx
M  features/products/components/product-form.tsx
M  features/bills/components/bills-table.tsx
M  features/bills/components/bill-details.tsx
M  features/audit/components/audit-workspace.tsx
M  features/customers/components/customer-ledger-workspace.tsx
M  features/suppliers/components/supplier-ledger-workspace.tsx
M  features/purchases/components/purchase-entry-screen.tsx
M  features/cash/components/cash-workspace.tsx
M  features/shift/components/shift-workspace.tsx
M  features/shift/components/shift-report.tsx
M  features/reports/components/z-report.tsx
M  app/page.tsx
M  app/settings/page.tsx
M  app/bills/[billId]/page.tsx
M  DESIGN_SYSTEM.md
```

Nothing under `lib/services`, `lib/db`, `lib/firebase`, `lib/i18n`, `types/domain.ts`, or `features/bills/components/pos-screen.tsx` was touched.

---

## Files changed (Phase 0 / Step 1)

```
M  app/layout.tsx                  # next/font wiring
M  app/globals.css                 # tokens, animations, number-input fix
M  package.json                    # + lucide-react
A  components/ui/number-field.tsx  # the new input
A  components/ui/icons.ts          # curated icon barrel
M  components/pos/quantity-stepper.tsx  # uses NumberField
A  REFACTOR_NOTES.md               # this file
```

Nothing under `lib/services`, `lib/db`, `lib/firebase`, `lib/i18n`, or
any route file was touched.

---

# Phase 2 — Money & quantity input ergonomics

## What this chunk changes

### 1. `currencySymbol()` added (`lib/utils/money.ts`)
New export that extracts the locale currency symbol (e.g. `₪`, `$`, `€`) from
`Intl.NumberFormat.formatToParts()`. Uses the same `normalizeCurrencyCode`
path as `formatCurrency` so symbol/ISO code settings both work. Falls back to
the ISO code string if `Intl` throws.

### 2. `MoneyInput` + `MoneyInputRHF` (`components/ui/money-input.tsx`)
Thin wrappers around `NumberField`/Controller that pre-configure:
- `precision="decimal" decimalScale={2}` — always 2-decimal money
- `align="end"` — right-aligned (conventional for currency columns)
- `inputSize="lg"` default — larger touch target for payment fields
- `prefix={currencySymbol(currency)}` — shows the symbol, not a hardcoded string

`MoneyInputRHF` mirrors the `NumberFieldRHF` Controller pattern so the caller
just passes `name`, `control`, and `currency`.

### 3. Call-site migration

**Money fields → MoneyInput / MoneyInputRHF:**

| File | Field |
|------|-------|
| `features/products/components/product-form.tsx` | buyPrice, sellPrice (+ added settingsRepo query for currency) |
| `features/expenses/components/expenses-workspace.tsx` | expense amount |
| `features/customers/components/customer-ledger-workspace.tsx` | payment amount |
| `features/suppliers/components/supplier-ledger-workspace.tsx` | payment amount |
| `features/cash/components/cash-workspace.tsx` | movement amount |
| `features/shift/components/shift-workspace.tsx` | opening cash, counted cash |
| `features/purchases/components/purchase-entry-screen.tsx` | unit cost (table + new-line), discount, tax, cash split, card split, actual paid |
| `features/bills/components/pos-screen.tsx` | discount, tax, cash split, card split, actual paid |

**Integer quantity fields → QuantityStepper:**

| File | Field |
|------|-------|
| `features/inventory/components/inventory-workspace.tsx` | counted quantity |
| `features/purchases/components/purchase-entry-screen.tsx` | row qty (table), new-line qty |
| `features/bills/components/bill-details.tsx` | return quantity |

`features/products/components/products-table.tsx` adjust-qty field intentionally
kept as raw `NumberField precision="integer"` — it's a signed delta (can be
negative), not a non-negative quantity count, so QuantityStepper's min=0
default doesn't apply.

Cart row qty in `pos-screen.tsx` (lines 791, 1067) left for Phase 4 per plan.

### 4. Pre-existing typecheck issue (not introduced)
`inventory-workspace.tsx:366` — `quantity.trim()` error still present (pre-dates
Phase 1). The `quantity` state is `number | null`; `.trim()` doesn't exist on
numbers. Not in scope for this phase.

## Files changed

```
M  lib/utils/money.ts
A  components/ui/money-input.tsx
M  features/products/components/product-form.tsx
M  features/expenses/components/expenses-workspace.tsx
M  features/customers/components/customer-ledger-workspace.tsx
M  features/suppliers/components/supplier-ledger-workspace.tsx
M  features/cash/components/cash-workspace.tsx
M  features/shift/components/shift-workspace.tsx
M  features/purchases/components/purchase-entry-screen.tsx
M  features/bills/components/pos-screen.tsx
M  features/bills/components/bill-details.tsx
M  features/inventory/components/inventory-workspace.tsx
M  DESIGN_SYSTEM.md
M  REFACTOR_NOTES.md
```

Nothing under `lib/services`, `lib/db`, `lib/firebase`, `lib/i18n`, or
any route file was touched.

---

# Phases 3–9 — Symbol icons, SearchableSelect/Modal upgrades & per-page colour token polish

## Status at sprint entry

Phases 3–6 were already complete before this sprint resumed:

- **Phase 3** — `SearchableSelect` already had portal panel, bottom-sheet on mobile, lucide chevron/check icons, and iOS keyboard fixes.
- **Phase 4** — `Modal` already had bottom-sheet on mobile, centered on desktop, drag-to-dismiss, and `presentation` prop.
- **Phase 5** — All `<Input type="number">` usages were already migrated to `NumberField` across the app.
- **Phase 6** — Native `<Select>` in settings tax mode and audit filters already replaced with `SearchableSelect`.
- **Phase 7** — Sidebar icons already in place.

## Phase 8 — Text symbols → lucide icons

The only remaining text-symbol usages were `×` remove buttons in two screens.

**`features/purchases/components/purchase-entry-screen.tsx`**
- Table row remove button: `×` → `<X size={14} aria-hidden />` with `aria-label="Remove"`
- Mobile remove button: `×` → `<X size={16} aria-hidden />` with `hover:text-danger`
- Added `X` to the lucide import alongside existing `CircleCheck`

**`features/bills/components/pos-screen.tsx`**
- Cart row remove button (desktop table): `×` → `<X size={14} aria-hidden />` with `aria-label="Remove"`
- Cart row remove button (mobile): `×` → `<X size={16} aria-hidden />` with `hover:text-danger`

## Phase 9 — Per-page colour token polish

Replaced every remaining raw Tailwind colour literal (`green-*`, `emerald-*`, `red-*`) in feature files with semantic design tokens. Typecheck passes (`npm run typecheck` clean) after all changes.

### Changes by file

| File | What changed |
|------|-------------|
| `features/bills/components/pos-screen.tsx` | Success panel: `bg-emerald-50/100/600/700` → `bg-success-soft/text-success`. Last-added chip: `border-emerald-200 bg-emerald-50 text-emerald-800/600/700` → `border-success/30 bg-success-soft text-success`. Validation errors: `text-red-600` → `text-danger` (×4) |
| `features/purchases/components/purchase-entry-screen.tsx` | Validation errors: `text-red-600` → `text-danger` (×4) |
| `features/bills/components/bills-table.tsx` | Sync badge: `synced` → `bg-success-soft text-success border-success/20`; `failed` → `bg-danger-soft text-danger border-danger/20`; `blocked` → `bg-danger-soft text-danger border-danger/30`. Profit column: `text-green-700` → `text-success` (desktop + mobile) |
| `features/products/components/products-table.tsx` | Sync badge: same pattern as bills-table. Stock preview diff: `text-green-700` → `text-success`, `text-red-600` → `text-danger` |
| `features/bills/components/bill-details.tsx` | Profit display: `text-green-600` → `text-success`. Bill status pill: `bg-green-100 text-green-700` → `bg-success-soft text-success`; `bg-red-100 text-red-700` → `bg-danger-soft text-danger` |
| `features/bills/components/quick-product-modal.tsx` | Stock alert: `text-red-600` → `text-danger` |
| `features/customers/components/customer-ledger-workspace.tsx` | Balance owing: `text-red-600` → `text-danger`; balance credit: `text-green-600` → `text-success` |
| `features/suppliers/components/supplier-ledger-workspace.tsx` | Balance owing: `text-red-600`/`text-red-500` → `text-danger`; balance credit: `text-green-600` → `text-success` |
| `features/cash/components/cash-workspace.tsx` | Outflow indicator: `text-red-700` → `text-danger` |
| `features/shift/components/shift-workspace.tsx` | Cash diff column negative: `text-red-700` → `text-danger` |
| `features/shift/components/shift-report.tsx` | Warning tone: `text-red-700` → `text-danger` |
| `features/inventory/components/inventory-workspace.tsx` | Stock diff positive: `text-green-600` → `text-success`; negative: `text-red-600` → `text-danger`. **Bug fix:** `quantity.trim()` (broken after Phase 2's QuantityStepper migration changed `quantity` type from `string` to `number \| null`) → `quantity !== null` |
| `features/products/components/product-form.tsx` | Validation errors: `text-red-600` → `text-danger` |
| `features/products/components/product-import-export.tsx` | Stat tone: `text-green-700` → `text-success`; `text-red-600` → `text-danger`. Import-ready banner: `bg-green-50 border-green-100 text-green-800` → `bg-success-soft border-success/20 text-success`. Import-errors panel: `bg-red-50 border-red-100` → `bg-danger-soft border-danger/20`; `text-red-700` (×2) → `text-danger` |

### TypeScript fix note

`inventory-workspace.tsx:366` had a pre-existing `quantity.trim()` call where
`quantity: number | null`. The Phase 2 `QuantityStepper` migration changed the
state type from `string` to `number | null`; `.trim()` no longer exists on
numbers. Fixed to `quantity !== null` — semantically identical (truthy string
↔ non-null number both indicate the user has entered a value).

## Files changed (Phases 3–9)

```
M  features/bills/components/pos-screen.tsx
M  features/purchases/components/purchase-entry-screen.tsx
M  features/bills/components/bills-table.tsx
M  features/products/components/products-table.tsx
M  features/bills/components/bill-details.tsx
M  features/bills/components/quick-product-modal.tsx
M  features/customers/components/customer-ledger-workspace.tsx
M  features/suppliers/components/supplier-ledger-workspace.tsx
M  features/cash/components/cash-workspace.tsx
M  features/shift/components/shift-workspace.tsx
M  features/shift/components/shift-report.tsx
M  features/inventory/components/inventory-workspace.tsx
M  features/products/components/product-form.tsx
M  features/products/components/product-import-export.tsx
M  DESIGN_SYSTEM.md
M  REFACTOR_NOTES.md
```

Nothing under `lib/services`, `lib/db`, `lib/firebase`, `lib/i18n`, `types/domain.ts`,
`components/ui/number-field.tsx`, or `components/pos/quantity-stepper.tsx` was touched.
`npm run typecheck` passes with zero errors.

---

# Phase 10 — Token sweep: shared UI components, app pages & admin views

## What this chunk changes

Completed the colour token migration across the remaining files that Phases 1–9 had not yet touched: shared UI primitives, provider components, the auth shell, and all app-level pages (including the admin user-management views).

`components/pwa/sw-register.tsx` intentionally left untouched — it is a developer-facing debug overlay with a dark backdrop; the `green-900`, `red-900`, `blue-900`, `amber-500` classes there are deliberate dark-theme colours with no semantic-token equivalents.

### Shared UI components

| File | Change |
|------|--------|
| `components/ui/button.tsx` | `danger` variant: `bg-red-50 text-red-700 hover:bg-red-100 active:bg-red-200` → `bg-danger-soft text-danger hover:bg-danger-soft/80 active:bg-danger-soft/60` |
| `components/ui/toast.tsx` | Toast pill: `bg-green-600`/`bg-red-600` → `bg-success`/`bg-danger` |
| `components/ui/form-field.tsx` | Required asterisk: `text-red-500` → `text-danger` |
| `components/ui/input.tsx` | Error-state border/ring: `border-red-400 focus:ring-red-400 focus:border-red-400` → `border-danger focus:ring-danger focus:border-danger` |
| `components/sync/sync-status-badge.tsx` | Blocked state: `bg-red-50 text-red-700 ring-red-200` → `bg-danger-soft text-danger ring-danger/20` |
| `components/barcode/barcode-scanner-modal.tsx` | Last-scanned confirmation: `text-green-600` → `text-success` |
| `components/auth/authenticated-shell.tsx` | Auth error banner: `text-red-600 bg-red-50 border-red-100` → `text-danger bg-danger-soft border-danger/20`; copy-error button: `text-red-700` → `text-danger`; error icon circle: `bg-red-100 text-red-600` → `bg-danger-soft text-danger` |
| `components/providers/db-bootstrap.tsx` | DB init error: `border-red-200 text-red-600` → `border-danger/20 text-danger` |

### Features (last two remaining literals)

| File | Change |
|------|--------|
| `features/audit/components/audit-workspace.tsx` | Sync audit-category badge: `bg-orange-50 text-orange-700 ring-orange-200` → `bg-warning-soft text-warning ring-warning/20` |
| `features/bills/components/pos-screen.tsx` | No-shift warning banner: `amber-*` → `warning` tokens. Item-count badge: `bg-blue-50 text-blue-700` → `bg-info-soft text-info` |

### App pages

| File | Change |
|------|--------|
| `app/page.tsx` | Dashboard decrease badge: `bg-red-50 text-red-700` → `bg-danger-soft text-danger`; decrease text: `text-red-700` → `text-danger` |
| `app/settings/page.tsx` | Sync error warnings (×2): `text-red-600` → `text-danger`. Conflicts-exist banner: `bg-red-50 border-red-200 text-red-800` → `bg-danger-soft border-danger/20 text-danger` |
| `app/error.tsx` | Error icon circle: `bg-red-50 text-red-600` → `bg-danger-soft text-danger` |
| `app/admin/users/page.tsx` | Access-denied: `border-red-100 text-red-600` → `border-danger/20 text-danger`. Error banner: `bg-red-50 border-red-100 text-red-600` → tokens. `SupportCard` tone "red"/"amber" → `text-danger`/`text-warning`. Create-form error → `text-danger bg-danger-soft`. Pending-approval section header + border → warning tokens. Links: `text-blue-500/600` → `text-info` |
| `app/admin/users/[uid]/page.tsx` | `STATUS_COLORS`/`HEALTH_COLORS` maps: `green-100/red-100/amber-100` → `success-soft/danger-soft/warning-soft` tokens. User-not-found: `border-red-100 text-red-600` → tokens. Error banners (×2): → `text-danger bg-danger-soft`. Stock qty zero: `text-red-600` → `text-danger`. Product status badge active: `bg-green-100 text-green-700` → `bg-success-soft text-success`. Movement qty change: `text-red-600`/`text-green-700` → `text-danger`/`text-success`. Reset-link button: `amber-*` → warning tokens. Approve button: `green-*` → success tokens. Toggle button: `red/green` → `danger-soft/success-soft`. Reset-link error: `text-red-600` → `text-danger`. Support no-warnings: `bg-green-50 border-green-100 text-green-707` → success tokens. Support warnings list: `bg-amber-50 border-amber-100 text-amber-700` → warning tokens. `BillStatusBadge`: `green/red/amber` → `success-soft/danger-soft/warning-soft`. Save error: → `text-danger bg-danger-soft`. Export buttons: `bg-blue-50 text-blue-700` → `bg-info-soft text-info`. Link hovers: `text-blue-600/700` → `text-info/text-info/80`. Save-settings button: `bg-blue-600 hover:bg-blue-700` → `bg-brand hover:bg-brand-hover` |

## Files changed (Phase 10)

```
M  components/ui/button.tsx
M  components/ui/toast.tsx
M  components/ui/form-field.tsx
M  components/ui/input.tsx
M  components/sync/sync-status-badge.tsx
M  components/barcode/barcode-scanner-modal.tsx
M  components/auth/authenticated-shell.tsx
M  components/providers/db-bootstrap.tsx
M  features/audit/components/audit-workspace.tsx
M  features/bills/components/pos-screen.tsx
M  app/page.tsx
M  app/settings/page.tsx
M  app/error.tsx
M  app/admin/users/page.tsx
M  app/admin/users/[uid]/page.tsx
M  REFACTOR_NOTES.md
```

Nothing under `lib/services`, `lib/db`, `lib/firebase`, `lib/i18n`, or `types/domain.ts` was touched.
`npm run typecheck` passes with zero errors.

**Status after Phase 10:** All feature files, shared UI components, providers, auth shell, and app pages are now using semantic design tokens exclusively. The only remaining raw Tailwind colour literals in the codebase are in `components/pwa/sw-register.tsx` (intentional dark-overlay debug UI) and commented-out dead code.

---

# Accessibility audit — Phase 3 follow-on

## What was audited

All primary interactive components were read and evaluated against WCAG 2.1 AA:
`Modal`, `ConfirmDialog`, `SearchableSelect`, `DataTable`, `SidebarNav`,
`authenticated-shell.tsx` (CashierShell + AdminShell + RestoreModal), `toast.tsx`,
`number-field.tsx` (read only, not changed — listed as cautioned file).

## Issues found and fixed

### i18n — new keys for accessibility labels

Three new keys added to `nav` section and one to `dataTable`:

| Key | EN | AR |
|---|---|---|
| `nav.mainNavLabel` | `"Main navigation"` | `"التنقل الرئيسي"` |
| `nav.adminNavLabel` | `"Admin navigation"` | `"تنقل المسؤول"` |
| `nav.skipToContent` | `"Skip to main content"` | `"تخطى إلى المحتوى الرئيسي"` |
| `dataTable.paginationNav` | `"Pagination"` | `"التنقل بين الصفحات"` |

Files: `lib/i18n/types.ts`, `lib/i18n/en.ts`, `lib/i18n/ar.ts`

### components/ui/toast.tsx

**Issue:** Toast container had no live-region attributes — screen readers never
announced new toasts.  
**Fix:** Added `role="status" aria-live="polite" aria-atomic="false"` to the container `<div>`.

### components/ui/modal.tsx

**Issues:**  
1. Hardcoded `id="modal-title"` — two modals open simultaneously share the same ID, breaking `aria-labelledby`.  
2. `description` prop was rendered in the header but never wired to `aria-describedby`.

**Fix:** Imported `useId()` and derived `titleId`/`descId` per instance. Set `aria-labelledby={titleId}`, `aria-describedby={description ? descId : undefined}`, and `id={descId}` on the description `<p>`.

### components/ui/confirm-dialog.tsx

**Issue:** `description` was rendered twice — once in the Modal header (via the
`description` prop) and again as a `<p>` in the modal body children.  
**Fix:** Removed the duplicate body paragraph. Description is now rendered only in
the Modal header, properly connected to `aria-describedby`.

### components/ui/data-table.tsx

**Issues:**  
1. Sortable `<th>` elements had no `aria-sort` — only visual arrows were present.  
2. Global search `<Input>` had no `aria-label` (placeholder alone is insufficient).  
3. Pagination buttons were inside a plain `<div>`, not a `<nav>`.

**Fix:**  
1. Computed `ariaSort` (`"ascending"` | `"descending"` | `"none"` | `undefined`) per column and set it on `<th aria-sort={ariaSort}>`.  
2. Added `aria-label={tableLabels.searchPlaceholder}` to the search Input.  
3. Wrapped the full pagination footer in `<nav aria-label={t('dataTable.paginationNav')}>`.

### components/ui/searchable-select.tsx

**Issues:**  
1. Search input had no `role`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, or `aria-autocomplete`.  
2. The listbox had no `id` for reference.  
3. Options had no `id` for `aria-activedescendant` to point at.

**Fix:** Imported `useId()`. Generated stable `listboxId` and `getOptionId(index)` helpers. Added `id={listboxId}` to the listbox `<div>`, `id={getOptionId(index)}` to each option `<button>`, and on the search input: `role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={listboxId} aria-activedescendant={open && filtered.length > 0 ? getOptionId(highlightedIndex) : undefined} aria-label={resolvedSearchPlaceholder}`.

### components/sidebar-nav.tsx

**Issues:**  
1. `<nav>` had no `aria-label` — indistinguishable from other `<nav>` elements by screen readers.  
2. Active links had no `aria-current="page"`.

**Fix:** Added `aria-label={t('nav.mainNavLabel')}` to `<nav>`. Added `aria-current={active ? 'page' : undefined}` to every `<Link>`.

### components/auth/authenticated-shell.tsx

**Issues:**  
1. No skip-to-content link in either shell (keyboard users must Tab through the entire sidebar to reach the main content).  
2. Admin `<nav>` had no `aria-label`. Admin nav link had no `aria-current`.  
3. `RestoreModal` used plain `<div>` elements with no `role="dialog"`, `aria-modal`, or `aria-labelledby` — invisible to screen reader dialog mode.

**Fix:**  
1. Added visually-hidden skip link as first child of both `AdminShell` and `CashierShell` layout divs, targeting `id="main-content"` on `<main>`. Uses `sr-only focus:not-sr-only` pattern with brand styling on focus.  
2. Added `aria-label={t("nav.adminNavLabel")}` to admin `<nav>`. Added `aria-current={pathname.startsWith("/admin") ? "page" : undefined}` to the admin link.  
3. In `RestoreModal`: imported `useId()`, derived `titleId`, added `role="dialog" aria-modal="true" aria-labelledby={titleId}` to the inner card div, added `id={titleId}` to the `<h2>`. Added `role="presentation"` to the outer backdrop div.

## Files changed (accessibility audit)

```
M  lib/i18n/types.ts
M  lib/i18n/en.ts
M  lib/i18n/ar.ts
M  components/ui/toast.tsx
M  components/ui/modal.tsx
M  components/ui/confirm-dialog.tsx
M  components/ui/data-table.tsx
M  components/ui/searchable-select.tsx
M  components/sidebar-nav.tsx
M  components/auth/authenticated-shell.tsx
M  DESIGN_SYSTEM.md
M  REFACTOR_NOTES.md
```

No business logic, service layer, Firebase sync, IndexedDB schemas, routes, or
translation values changed. Only new i18n keys were added (additive — no existing
key removed or renamed). `npm run typecheck` passes with zero errors.

---

# Quick-fix — QuickProductModal money inputs

## What changed

`features/bills/components/quick-product-modal.tsx` used `NumberFieldRHF` with
`precision="decimal"` for `sellPrice` and `buyPrice` — violating the design system
rule that all currency inputs must use `MoneyInputRHF`.

Fix: replaced both fields with `MoneyInputRHF`. Added `currency: string` prop to
`QuickProductModal`; the parent `pos-screen.tsx` passes `currency` (already had it
from settings). No change to form schema, zod validation, or service calls.

```
M  features/bills/components/quick-product-modal.tsx
M  features/bills/components/pos-screen.tsx
```

`npm run typecheck` passes with zero errors.

---

# Mobile POS UX Finalization Sprint — Phase 1: Mobile bottom navigation

## Motivation

The previous horizontal scrolling pill row required cashiers to scroll through 14
routes to find anything beyond the first few items. A fixed bottom tab bar (iOS /
Android native POS pattern) gives 4 primary actions at a thumb-tap and hides the
remaining routes behind a "More" sheet.

## What changed

### New component — `components/mobile-bottom-nav.tsx`

Fixed bottom tab bar visible only on mobile (`lg:hidden`). Shows five items:

| Position | Icon | Route |
|---|---|---|
| 1 | ShoppingCart | `/billing` — Sell (primary action) |
| 2 | ReceiptText | `/bills` — Bills |
| 3 | Package | `/products` — Products |
| 4 | Boxes | `/inventory` — Stock |
| 5 | MoreHorizontal | More (opens sheet) |

**More sheet** — bottom sheet (`role="dialog"`) with a 4-column icon grid covering the 10 remaining routes: Dashboard, New Purchase, Reports, Customers, Suppliers, Shift, Cash Drawer, Expenses, Audit Log, Settings.

- Shift open indicator dot appears on the Shift tile when a shift is active.
- Sheet closes on route change (`useEffect` watching `pathname`).
- Escape key, backdrop tap, and ×-button all close the sheet.
- `aria-live="polite"` on the More button's `aria-expanded` communicates sheet state to screen readers.

### Updated — `components/sidebar-nav.tsx`

- Removed mobile horizontal pill presentation entirely (now `hidden lg:flex`).
- Removed `shortKey` field from the `Route` interface and route array (only needed for the now-removed mobile pills).
- All routes use the full `key` label on desktop.
- Hardcoded `aria-label="Shift open"` replaced with `t('nav.shiftOpen')`.
- Cleaner CSS: mobile `lg:*` prefixes removed, class list reduced.

### Updated — `components/auth/authenticated-shell.tsx` (`CashierShell`)

- Return wrapped in `<>...</>` fragment so `<MobileBottomNav />` can be a sibling of the grid.
- `<MobileBottomNav />` added after the outer grid div.
- Mobile header bar comment updated to clarify intent.
- `pb-24` on `<main>` already keeps content above the fixed bottom nav.

### New i18n keys

| Key | EN | AR |
|---|---|---|
| `nav.shiftOpen` | `"Shift open"` | `"دوام مفتوح"` |
| `nav.moreMenuLabel` | `"More"` | `"المزيد"` |
| `navShort.more` | `"More"` | `"المزيد"` |

## Files changed (Phase 1)

```
A  components/mobile-bottom-nav.tsx
M  components/sidebar-nav.tsx
M  components/auth/authenticated-shell.tsx
M  lib/i18n/types.ts
M  lib/i18n/en.ts
M  lib/i18n/ar.ts
M  DESIGN_SYSTEM.md
M  REFACTOR_NOTES.md
```

No business logic, service layer, or route configuration changed.
`npm run typecheck` passes with zero errors.

---

# Mobile POS UX Finalization Sprint — Phase 2: POS checkout UX

## Motivation

Four friction points in the POS bill-summary panel identified in the AI review:

1. **Payment method** — a SearchableSelect dropdown requires two taps (open, pick). A
   segmented control shows all four methods at once and selects in one tap.
2. **Cash tender chips** — fixed denominations (5, 10, 20, 50, 100) are often wrong
   for the bill total. Context-aware chips (based on the actual total) are always ≥
   the total and meaningful.
3. **Customer selection** — two free-text fields with a typeahead popup are hard to
   use on mobile. A "select customer" button + modal sheet gives a larger touch target
   and a searchable customer list. New customers can still be entered manually.
4. **Offline/sync state** — the SuccessPanel showed no indication of whether the bill
   was synced to the cloud yet. A live-updating badge reassures cashiers about data
   safety.

## What changed

### New component — `components/pos/payment-method-control.tsx`

A `role="radiogroup"` group of four `role="radio"` tap cards replacing the
SearchableSelect dropdown for payment method selection in both the POS billing screen
and the purchase entry screen.

- Grid: `grid-cols-2` on mobile, `grid-cols-4` on sm+.
- Each card: icon above label. Active state: `bg-brand text-white`. Inactive: white
  border + slate text + hover state.
- Icons: `Banknote` (Cash) · `CreditCard` (Card) · `Coins` (Mixed) · `Clock` (Credit).
- Props: `value: PaymentMethod`, `onChange: (v: PaymentMethod) => void`, `label: string`.
- Fully keyboard/screenreader accessible via ARIA radiogroup/radio pattern.

### Updated — `features/bills/components/pos-screen.tsx`

**Payment method**: replaced `SearchableSelect` with `PaymentMethodControl`.

**Smart cash chips**: replaced fixed `[5, 10, 20, 50, 100]` chips with a computed set
via `smartCashChips(total)`. The function steps through denominations `[10, 50, 100,
200, 500, 1000]`, collecting the first 3 unique rounded-up values above the total.

Examples:
- Total ₪43 → chips `[₪50, ₪100, ₪200]`
- Total ₪87 → chips `[₪90, ₪100, ₪200]`
- Total ₪100 → chips `[₪200, ₪500, ₪1000]`

Chips show formatted currency (via `formatCurrency`) so they respect the shop's
currency setting.

**Customer select sheet**: the two free-text name/phone fields + inline typeahead
dropdown have been replaced with:
- If no customer is selected: a dashed button "Select customer" that opens a modal.
- If a customer is selected: a compact chip showing name + phone with two buttons
  (Search/edit — reopens the modal; X — clears both fields).
- The modal has a search input (searches by name or phone against the full customer
  list), a scrollable list (max 20 results), and a `<details>` "Enter manually"
  section with name/phone text inputs for new customers not yet in the database.
- The `customerName` and `customerPhone` react-hook-form fields remain unchanged —
  only the presentation layer changed.
- Removed the now-unused `customerFieldFocused` state, `customerSuggestions` useMemo,
  and `setCustomerFieldFocused` calls.

**Offline/sync badge in SuccessPanel**: after a bill is saved, a badge in the success
header shows "Saved locally · Pending sync" (warning-soft, CloudUpload icon) or
"Synced to cloud" (success-soft, Cloud icon). The badge updates live via
`useLiveQuery(() => db.bills.get(bill.id), [bill.id])` so it transitions to "Synced"
the moment the background sync worker picks up the bill.

### Updated — `features/purchases/components/purchase-entry-screen.tsx`

Payment method: replaced `SearchableSelect` with `PaymentMethodControl` (same
component, same pattern, same i18n keys).

### New i18n keys

| Key | EN | AR |
|---|---|---|
| `billing.pickCustomer` | `"Select customer"` | `"اختر عميلاً"` |
| `billing.clearCustomer` | `"Clear"` | `"مسح"` |
| `billing.searchCustomers` | `"Search customers"` | `"ابحث عن عميل"` |
| `billing.noCustomersFound` | `"No customers found"` | `"لا يوجد عملاء مطابقون"` |
| `billing.enterManually` | `"Enter manually"` | `"أدخل يدوياً"` |
| `billing.savedLocally` | `"Saved locally · Pending sync"` | `"محفوظ محلياً · في انتظار المزامنة"` |
| `billing.syncedToCloud` | `"Synced to cloud"` | `"تمت المزامنة مع السحابة"` |

## Files changed (Phase 2)

```
A  components/pos/payment-method-control.tsx
M  features/bills/components/pos-screen.tsx
M  features/purchases/components/purchase-entry-screen.tsx
M  lib/i18n/types.ts
M  lib/i18n/en.ts
M  lib/i18n/ar.ts
M  DESIGN_SYSTEM.md
M  REFACTOR_NOTES.md
```

No business logic, service layer, Firebase sync, IndexedDB schemas, routes, or
existing translation keys changed. `npm run typecheck` passes with zero errors.

---

# Mobile POS UX Finalization Sprint — Phase 2 post-review fixes

## Issues addressed from AI review

### P0 — POS checkout bar / bottom nav overlap

`MobileBottomNav` now returns `null` when `pathname.startsWith("/billing")`.

On the Sell screen, the sticky checkout bar (totals + "Review & finalize" button,
`bottom-0 z-30`) is the primary cashier action. The bottom nav
(`bottom-0 z-40`) would obscure it. Hiding the nav on `/billing` gives the checkout
bar full screen real estate — the cashier is focused on one task (completing the sale)
and doesn't need to navigate away mid-sale.

Rule added to DESIGN_SYSTEM.md §23.

### Purchase mobile item cards — editable quantity + cost

Mobile purchase cards now show:
- Product name + current stock
- Quantity: `QuantityStepper` (inline edit)
- Unit cost: `MoneyInput` (inline edit, `inputSize="sm"`)
- Subtotal row below a divider

This mirrors the desktop DataTable capabilities (QuantityStepper + MoneyInput per
row) so a purchase can be fully assembled from a phone.

### Hardcoded / untranslated text

| File | Was | Now |
|---|---|---|
| `bills-table.tsx` L417 | `"Previous"` | `t("dataTable.previous")` |
| `bills-table.tsx` L430 | `"Next"` | `t("dataTable.next")` |
| `purchase-entry-screen.tsx` L642 | `"Loading…"` | `t("common.loading")` |
| `purchase-entry-screen.tsx` L631 | `aria-label="Remove"` | `aria-label={t("common.remove")}` |
| `purchase-entry-screen.tsx` L767 | `aria-label="Remove"` | `aria-label={t("common.remove")}` |

## Files changed (post-review)

```
M  components/mobile-bottom-nav.tsx
M  features/bills/components/bills-table.tsx
M  features/purchases/components/purchase-entry-screen.tsx
M  REFACTOR_NOTES.md
```

`npm run typecheck` passes with zero errors.

## Bug fix — MobileBottomNav Rules of Hooks violation

The post-review change that hides the bottom nav on `/billing` was first
implemented with an early `return null` placed **before** `useLiveQuery`
and three `useEffect` calls. That violates the Rules of Hooks: navigating
to/from `/billing` changes the number of hooks React sees between renders,
which crashes at runtime with "Rendered fewer hooks than expected".
`tsc --noEmit` does **not** catch this.

Fix: moved the `if (pathname.startsWith("/billing")) return null;` guard to
**after** every hook call (after `isMoreActive` is computed, immediately
before the JSX `return`). The `isActive` helper is a plain function, not a
hook, so it can stay above the guard.

Verified the CustomerSelectSheet manual-entry inputs (`defaultValue` +
`onBlur`) are **not** affected by stale state: `Modal` returns `null` when
closed (`components/ui/modal.tsx` L211), so the inputs remount fresh on each
open and pick up the current form value.

`npm run typecheck` passes with zero errors.

## Bug fix — paid-amount draft recovery clobbers manual override

Known active bug. On draft restore, `isPaidAmountManuallyEdited` was left at
its `false` default, so the auto-fill `useEffect` overwrote a cashier-entered
paid amount with the bill/purchase total on the next page load.

- **POS (`pos-screen.tsx`)** already recomputed the auto-total on restore, but
  compared against the raw total — a saved *credit* sale (paidAmount 0) was
  wrongly flagged as a manual override. Now compares against the credit-aware
  default (`0` for credit, else total).
- **Purchase (`purchase-entry-screen.tsx`)** had **no** guard — the flag stayed
  `false` and the manual amount was always overwritten. Added the same
  credit-aware reconstruction.

Return-to-auto-fill after a manual edit is already handled by the "Reset"
button (both screens) and the "Exact" chip (POS).

`npm run typecheck` passes with zero errors.

## SupplierSelectSheet — purchase screen parity with POS

The purchase screen's supplier field still used the old focus-tracked floating
typeahead dropdown (`supplierFieldFocused` state + `supplierSuggestions` memo +
absolutely-positioned `<ul>`). Replaced it with the same select-sheet pattern
the POS customer field uses:

- Trigger is a chip (name + phone, with Search/Clear buttons) when a supplier is
  selected, or a dashed "Select supplier" button when empty.
- Tapping opens a `Modal` sheet with a search input (filters the live supplier
  list by name / normalized phone, max 20), a tap-list of results, and a
  `<details>` "Enter manually" disclosure for ad-hoc suppliers.

Removed: `supplierFieldFocused`, `supplierSuggestions`, the floating dropdown,
and the `onFocus`/`onBlur` timers on the old inputs.

New i18n keys (en + ar): `purchases.pickSupplier`, `purchases.clearSupplier`,
`purchases.searchSuppliers`, `purchases.noSuppliersFound`,
`purchases.enterManually`.

Documented the select-sheet pattern in DESIGN_SYSTEM.md §11.

`npm run typecheck` passes with zero errors.

## Offline-first fonts — next/font/google → next/font/local (vendored)

`app/layout.tsx` loaded three families via `next/font/google`
(Plus Jakarta Sans, IBM Plex Sans Arabic, JetBrains Mono). `next/font/google`
fetches the woff2 files from Google **at build time**, so any build without
internet (CI / air-gapped store servers) failed — directly at odds with the
offline-first goal.

Fix: vendored the woff2 files into `app/fonts/` and switched to
`next/font/local`. The CSS-variable contract (`--font-sans`, `--font-arabic`,
`--font-mono`) and `globals.css` are unchanged, so nothing visual moved.

- `scripts/vendor-fonts.mjs` — one-off helper that pulls the exact woff2 files
  from the Google Fonts CSS API (run `node scripts/vendor-fonts.mjs` to refresh).
- Variable families (Plus Jakarta Sans `400 800`, JetBrains Mono `400 700`) →
  one file each; IBM Plex Sans Arabic is static → one file per weight (400–700).
- Subsets vendored: `latin` for the Latin families, `arabic` for Arabic
  (~237 KB total, 6 files).

Verified: `npm run build` succeeds and emits the local fonts to
`.next/static/media/` (PlusJakartaSans_latin, JetBrainsMono_latin,
IBMPlexSansArabic_arabic_400–700) with **zero** Google requests. No
`next/font/google` references remain in the codebase. `npm run typecheck` clean.

Documented in DESIGN_SYSTEM.md §4.

## Polish — enhanced toasts + design-token migration

### Toast system (`components/ui/toast.tsx`)

Upgraded the bare success/error toast into a richer, mobile-first component
without changing the `push()` call contract (still `push(message, tone?)`,
defaulting to `success` — all 26 existing call sites keep working):

- Two new tones: `info` and `warning` (backward compatible union).
- Per-tone leading icon in a soft chip (`CircleCheck` / `CircleAlert` / `Info`
  / `TriangleAlert`), neutral `bg-surface` card body so toasts stay legible on
  any background.
- Tap-to-dismiss `X` button (`aria-label={t('common.close')}`).
- Slide-up entrance via new `animate-toast-in` keyframe (globals.css).
- Tone-aware duration: success/info 3s, error/warning 5s.
- a11y `role="status" aria-live="polite"` preserved.

### Design-token migration (removed banned raw color scales)

The design system forbids raw `red/green/emerald/amber/blue` scales for
status/brand (except the intentional dark debug overlay in `sw-register.tsx`).
Remaining live violations were all interactive-control accents/rings:

| File | Was | Now |
|---|---|---|
| `app/settings/page.tsx` (×2) | `accent-blue-600` | `accent-brand` |
| `app/admin/users/[uid]/page.tsx` (×2) | `accent-blue-600` | `accent-brand` |
| `app/admin/users/[uid]/page.tsx` (×3) | `focus:ring-blue-500` | `focus:ring-brand` |
| `app/admin/users/page.tsx` | dead commented `HEALTH_STYLES` block w/ raw scales | removed |

Left intentionally: the audit category badge palette
(`audit-workspace.tsx`) uses `violet/sky/fuchsia/indigo/rose` — these are
*categorical taxonomy* hues for 9 distinct audit categories (not status/brand,
not on the banned list); collapsing them into the 5 semantic tokens would make
categories indistinguishable.

Verified: no live banned-scale refs remain (grep), `npm run typecheck` clean,
`npm run build` succeeds. Documented in DESIGN_SYSTEM.md §11 + §15.

## Production-readiness pass #2/#3/#4 (post-review)

### #2 — Settings now actually enforced (was the P0 "fake settings")

Several store settings were editable but ignored. Now wired, in the UI **and**
defensively in `lib/services/billing-service.ts`:

- **Payment methods** (`enableCash/Card/Credit`): `PaymentMethodControl` gained an
  `available` prop; POS + purchases derive it from settings. `mixed` shows only
  when cash+card are both on. A disabled-but-selected method auto-corrects to the
  first allowed one. Service rejects a disabled method (`BILL_PAYMENT_METHOD_DISABLED`).
- **`requireShift`**: POS finalize is now a hard block (added to `canFinalize` +
  inline error `billing.shiftRequiredError`); service throws `BILL_SHIFT_REQUIRED`.
  Previously only a soft banner.
- **`defaultDiscountLimit`**: POS caps discount (inline `billing.discountLimitExceeded`);
  service throws `DISCOUNT_EXCEEDS_LIMIT`. 0 = no limit.
- **`taxMode === 'none'`**: hides the manual tax field + forces `taxAmount` 0 (POS +
  purchases). NOTE behavior change — the settings default is `none`, so the tax field
  is hidden by default; shops wanting manual tax set mode to inclusive/exclusive.
  inclusive/exclusive both keep the current additive manual field (no rate engine yet).
- **`lowStockThreshold`**: new `lib/utils/stock.ts` (`lowStockLimit` / `isLowStock`).
  A product's own `minimumStockAlert` wins when > 0; otherwise the global threshold
  applies. Wired into products-table + inventory-workspace low-stock detection.

New i18n: errors `DISCOUNT_EXCEEDS_LIMIT`, `BILL_SHIFT_REQUIRED`,
`BILL_PAYMENT_METHOD_DISABLED`; billing `shiftRequiredError`, `discountLimitExceeded`
(en + ar + types).

### #3 — Sidebar active vs hover were indistinguishable

Both used `bg-white/10`. Now: active = `bg-brand/20` + inset brand ring + the existing
3px brand edge bar + full-white icon ("I am here"); hover = `bg-white/[0.045]` faint
wash ("I can click this"). Added `lg:gap-1` between items. `components/sidebar-nav.tsx`.

### #4 — Offline route coverage completed

`NAV_ROUTES` (`public/sw.js`) and `OFFLINE_NAV_ROUTES` (`sw-register.tsx`) were missing
`/cash`, `/expenses`, `/audit`, `/reports/z`. Added all four to both lists and bumped
`CACHE_VERSION` 0.1.10 → 0.1.11 so clients re-precache.

Verified: `npm run typecheck` clean, `npm run build` succeeds.

### Pre-commit adjustments (review follow-up)

Three fixes after re-review of the settings-enforcement work:

1. **Tax mode tightened.** Only `exclusive` now shows the manual tax field; `none`
   AND `inclusive` hide it and force `taxAmount` 0. Reason: with only a manual
   amount (no rate engine), an `inclusive` value would be double-counted by
   `total = subtotal - discount + tax`. Normalised authoritatively in the service
   layer via `effectiveTaxAmount(settings, taxAmount)` so a stale/offline client
   can't submit tax when the mode forbids it — applied in billing **and** purchase
   services (totals + saved `taxAmount`).

2. **Payment gating extended to `purchase-service.ts`.** Pulled the policy into a
   shared `lib/services/settings-policy.ts` (`assertPaymentMethodEnabled`) used by
   both services. Error code generalised `BILL_PAYMENT_METHOD_DISABLED` →
   `PAYMENT_METHOD_DISABLED` (applies to bills + purchases). UI-only enforcement
   wasn't enough for an offline-first app (stale cache, direct callers, supplier
   balance / drawer / cloud-sync impact).

3. **Discount limit unit mismatch fixed.** The setting was labelled "Max discount
   per bill (%)" with a `%` input but enforced as a currency amount
   (`discountAmount > defaultDiscountLimit`). Converted the setting to a money
   **amount** (`MoneyInputRHF`, label "Max discount per bill"), so label, input,
   and enforcement now agree.

Verified: `npm run typecheck` clean, `npm run build` succeeds, no stale
`BILL_PAYMENT_METHOD_DISABLED` references remain.

### Pre-commit fixes round 2 (review follow-up)

1. **Tax preview validation now uses effective tax.** `createFinalizedBill` and
   `createFinalizedPurchase` previously computed the *pre-transaction* preview
   total with raw `input.form.taxAmount`, so a stale offline client sending tax
   under a non-"exclusive" mode could trip a false `BILL_PAID_TOO_LOW` /
   `BILL_MIXED_SPLIT_MISMATCH` (and purchase equivalents) on a total the
   transaction then discarded. Both now read settings up front and run the
   preview through `effectiveTaxAmount()`. The transaction still re-reads
   settings as the authoritative copy.

2. **Settings blocks the all-payment-methods-disabled state.** `onSubmit` now
   rejects saving when cash, card and credit are all off
   (`settings.atLeastOnePaymentMethod`, en + ar). This removes the UI/service
   mismatch where the POS fell back to cash but the service rejected cash.

Verified: `npm run typecheck` clean, `npm run build` succeeds.

## Offline multi-device sync correctness (two P0s)

Settings now drives business rules, which surfaced two offline/multi-device
data-correctness bugs. New single source of truth: `lib/services/settings-sync-fields.ts`
(`SETTINGS_BUSINESS_FIELDS`, `SETTINGS_SEQUENCE_FIELDS`, `SETTINGS_TRACKED_FIELDS`,
`mergedSequences()`, `finiteSequence()`, `isSettingsSequenceField()`).

### P0-1 — nextPurchaseSequence was not sync-safe

`nextBillSequence` had monotonic (max-merge, never-conflict) handling in 6 places;
`nextPurchaseSequence` had none, so across devices the purchase counter could
regress / be overwritten and reissue PO numbers. Fixed everywhere bill sequence
was handled, now covering BOTH counters via `mergedSequences()`:
- `cloud-merge-service.ts` — `prepareSettingsForCloudSync` max-merges both; business
  vs sequence split via `isSettingsSequenceField`.
- `cloud-pull-service.ts` — pull max-merges both; "local ahead" checks either counter.
- `sync-service.ts` — `mergeSettingsSequenceFromCloud` + `syncSettingsToCloud` handle
  both; `syncBillSequenceToCloud` → renamed `syncSettingsSequencesToCloud` (merges both).
- `sync-conflict-service.ts` — `isOnlyBillSequenceConflict` → `isOnlySequenceConflict`
  (auto-ignores conflicts where only counter fields changed).
- `sync-provider.tsx` — `isBillSequenceJob` → `isSequenceJob` (bill-sequence OR
  purchase-sequence) routes both through `syncSettingsSequencesToCloud`.
- `restore-service.ts` — restore recomputes `nextPurchaseSequence` from restored PO
  numbers (new `getPurchaseSequenceFromNumber`) and cloud-restore max-merges both.

### P0-2 — settings conflict/pull field list was incomplete

`cloud-merge-service` and `cloud-pull-service` only tracked 6 of ~20 settings
fields, so an offline device could silently overwrite another device's changes to
`taxMode`, `enableCash/Card/Credit`, `requireShift`, `defaultDiscountLimit`,
`rolePermissions`, receipt header/footer, business address/phone, low-stock
threshold, expiry warning days. Both files now compare `SETTINGS_TRACKED_FIELDS`
(all business fields + both counters), so every editable setting participates in
conflict detection and cloud pull.

Verified: `npm run typecheck` clean, `npm run build` succeeds, no stale
`syncBillSequenceToCloud` / `isBillSequenceJob` / `SETTINGS_FIELDS` references.

Note: real browser offline→online multi-device sync test still required before
production (cannot be run from source inspection).

## P1/P2 polish — a11y, mobile logout, currency, reduced motion

- **Mobile logout → More → Account.** Extracted `SafeSignOutButton` into
  `components/auth/safe-sign-out-button.tsx`. Removed it from the POS mobile
  header (now store name + sync state only); added an Account section
  (avatar + name/email + sign-out) to the More sheet. Desktop sidebar foot and
  the admin shell keep their own sign-out. Unsynced-data warning modal unchanged.
- **More-sheet focus management.** Focus first control on open, trap Tab/Shift+Tab,
  Escape-to-close, restore focus to the More trigger on close. Containment guard
  (`sheet.contains(document.activeElement)`) lets the nested portaled sign-out
  modal keep its own focus/Escape.
- **Currency dropdown.** Settings currency is now a `SearchableSelect` (ILS first
  for the local market); pre-existing non-listed codes are preserved. No more
  free-text typos.
- **`prefers-reduced-motion`** global block in `globals.css` (WCAG 2.3.3).
- New i18n: `nav.account` (en + ar).

## Security — Firestore admin role mismatch (P0)

`firestore.rules` `isActiveAdmin()` checked `role == 'admin'`, but the app has no
'admin' role (`UserRole = owner | manager | cashier | accountant`; `isAdmin =
role === 'owner'`). So every admin-support Firestore op (reading other profiles,
creating users, admin settings writes) was silently rejected against real
Firestore. Fixed to accept `'owner'` (canonical) with `'admin'` as a legacy
fallback. The admin-support settings `hasOnly` allow-list was left intentionally
narrow (support shouldn't silently rewrite a store's tax/payment rules) — flagged
for a product decision. No rules test runner is configured; validate with the
Firebase emulator before deploy.

## Payment-method setting scope clarified

`settings.paymentMethodsDesc` now states the toggles apply to sales + purchase
checkout, and that customer/supplier payments and expenses keep their own methods
(en + ar). The gating is intentionally scoped to POS sale/purchase, not ledgers.

Verified: `npm run typecheck` + `npm run build` green for the code changes
(rules excluded — no emulator here).

## Scope decision + four follow-up items

**Store model decision:** single-user-per-store is the intended release model.
The per-user data layer (`/users/{uid}/*`) is correct by design; the review's
"multi-user shared store" gap is intentionally OUT OF SCOPE. Roles
(manager/cashier/accountant) exist but each login still owns its own data.

### Service-level permission guards (P1, security)

UI hiding isn't enough offline. New `lib/services/permission-service.ts`
(`getCurrentPermissions`, `assertPermission`) mirrors `usePermissions` but reads
role offline via `firebase auth.currentUser` + Dexie `authCache`, then
`DEFAULT_ROLE_PERMISSIONS` + `settings.rolePermissions`. Unknown role falls back
to `cashier` (fail closed). Guards added (called before the rw transaction):
- `voidBill` → `canVoid`
- `returnBillItem` → `canReturn`
- `createFinalizedBill` → `canDiscount` when `discountAmount > 0`
- `updateProductDetails` → `canEditCost` when `buyPrice` changes
New error `PERMISSION_DENIED` (en/ar/types). Export actions left to the UI for now.

### Offline bill-detail handling (P1)

The success panel's "Open bill" links to the dynamic `/bills/[id]` route, which
may not be SW-cached offline. New `lib/hooks/use-online-status.ts`; when offline
the link becomes a disabled chip with "Opens when back online"
(`billing.billDetailOfflineHint`). The full receipt is already shown inline, so
nothing is lost offline.

### Structured toast API (P2)

`push()` now accepts `string` (unchanged) OR
`{ title, description?, tone?, actionLabel?, onAction? }`. Renders title +
optional description + an optional inline action button. All existing call sites
keep working (string path). `ToastInput` exported.

### Shared-component design tokens (P2)

Migrated raw slate/blue/emerald/amber/red to semantic tokens in `Card`,
`Button`, `Input`, `EmptyState`, and `lib/design/variants.ts` (badge/alert/panel
tones → `*-soft` + `text-*`; surfaces → `bg-surface*`/`text-fg*`; borders →
`border-border-*`; spinner accent → `border-t-brand`). Modal backdrop scrim kept
as raw `slate-900/50` intentionally (neutral overlay, not status/brand).

### Plus: Firestore role fix + payment-scope copy (this session)

- `firestore.rules` `isActiveAdmin()` now accepts `'owner'` (canonical; the app
  has no 'admin' role) with `'admin'` as a legacy fallback. Was silently
  rejecting all admin-support ops. Validate with the Firebase emulator before deploy.
- `settings.paymentMethodsDesc` clarified: the toggles scope to sales + purchase
  checkout; customer/supplier payments + expenses keep their own methods.

Verified: `npm run typecheck` + `npm run build` green (rules excluded — no emulator here).

## Structured toast in POS + admin localization

### POS sale-completed toast
`finalize()` now fires a structured success toast on top of the SuccessPanel:
title `Sale completed · {billNumber}` + a sync-aware description
(`saleSavedSyncing` online / `saleSavedOffline` offline) — reinforces
offline-first trust. No action button (the panel owns open-bill / new-sale).
`PosScreen` now uses `useOnlineStatus()`. New billing keys (en/ar/types).

### Admin-page localization
- **`app/admin/users/page.tsx` — fully localized**: access-denied screen,
  load/refresh/update errors, loading + empty + search, the table title/desc,
  and the entire New User form (labels, placeholders, role options, buttons,
  create errors). `CreateUserForm` gained `useLocale`. ~30 new `admin.*` keys
  (en/ar/types).
- **`app/admin/users/[uid]/page.tsx`**: localized the Recent Customer Payments /
  Recent Stock Movements / Products table titles + empty states + Export CSV,
  and the **SettingsCard** in full (heading, Edit, field labels — reusing
  `settings.*` keys — toggles, save/cancel buttons, save error, read-only rows,
  Yes/No/On/Off, Last Updated). `SettingsCard` gained `useLocale`.
- **`app/settings/page.tsx`**: the role-matrix "(full)" marker →
  `settings.roleFullAccess`.

Intentionally left English: **CSV export column headers** (`exportBillsCSV` /
`exportProductsCSV` arrays) — these are data-interchange field names, not UI.

**Still remaining (admin localization follow-up):** the visible `ColumnDef`
headers in the `[uid]` support-detail DataTables (Bill #, Date, Customer,
Payment, Subtotal, … and the product/movement/payment column headers). These
are admin-support-only table headers; ~30 strings. Not done this pass.

Verified: `npm run typecheck` (both locales satisfy the expanded dict) +
`npm run build` green.

## Sync badges everywhere + mobile store name + QA guide

- **`PRODUCTION_QA.md`** added — step-by-step guide for the human-only checks:
  (A) real offline→online multi-device sync test, (B) Firestore rules emulator
  validation, (C) CI `npm ci && typecheck && build`.
- **Per-record sync badges** — extracted shared `components/sync/record-sync-badge.tsx`
  (`RecordSyncBadge`, the per-row pill; distinct from the global `SyncStatusBadge`)
  and added a sync column/badge to: cash movements, expenses, inventory stock
  movements, and the customer + supplier payment detail lists. Bills and products
  already had it. Header uses `t("sync.status")`. (The two pre-existing local
  `SyncBadge` copies in bills/products were left as-is to avoid churn — candidates
  for later dedup onto the shared component.)
- **Mobile header store name** — the POS mobile header now shows
  `settings.storeName` (falls back to the "Shopkeeper POS" brand until settings
  load), giving cashiers store context instead of the brand.

Verified: `npm run typecheck` + `npm run build` green.

### Still on the code side (not yet done)
Conflict resolver → human-readable diff; Reports → source navigation links;
`[uid]` admin DataTable column headers (~30 strings); login/auth placeholders +
SW offline fallback copy. And a decision needed: number/quantity primitive
aria-labels (Increase/Decrease/Quantity) live in the designated do-not-touch
primitives — needs explicit approval to modify.

## Final review pass — conflict resolver, reports nav, aria-labels, localization tail

- **Conflict resolver is now human-readable** (`components/sync/conflict-resolver-modal.tsx`).
  Replaced the raw `JSON.stringify` dumps with a field-by-field table showing only
  the **changed fields** as "This device" vs "Cloud", with humanized field names
  and friendly value formatting. Buttons reordered to Keep-this-device / Keep-cloud
  / Mark-reviewed. New `sync.*` keys: field, localValue, cloudValue, conflictGeneric.
- **Reports cards link to their source** (`StatCard` gained an optional `href`;
  the whole card becomes a link with a chevron + hover/focus affordance). Wired:
  Total Sales/Bill Count → /bills, Cash Expected → /shift, Customer Payments →
  /customers, Purchase Cost → /purchases/new, Cash Paid Out → /cash, Supplier
  Payments → /suppliers.
- **Number/Quantity aria-labels localized** — `NumberField` (+/- buttons) and
  `QuantityStepper` (field label) now pull `common.increase` / `common.decrease`
  / `common.quantity` via `useLocale`. Done as a **behavior-preserving, additive**
  change (QuantityStepper also gained an optional `ariaLabel` override); the
  visible/functional behaviour of these primitives is unchanged — only the
  screen-reader label is now translated. (Touched the two "do-not-touch"
  primitives only for this a11y label, with the user's explicit go-ahead.)
- **Login/register placeholders localized** — `auth.emailPlaceholder` /
  `namePlaceholder` / `phonePlaceholder` (the sign-in + sign-up gate in
  authenticated-shell). Labels/buttons/errors were already localized.
- **`[uid]` admin DataTable column headers localized** — bill/payment/movement
  table headers (Bill #, Date, Customer, Payment, Net Total, Status, Note,
  Amount, Type, Reference, Qty) now use new `admin.col*` keys. The CSV **export**
  header arrays are intentionally left English (data-interchange field names).

Left intentionally English: the service-worker offline fallback HTML — a plain
SW can't use the React i18n system, and it's a rare edge screen (reviewer agreed
this is acceptable).

Verified: `npm run typecheck` (both locales satisfy the dict) + `npm run build` green.

### Status
All code items from the review series are now addressed. The only outstanding
work is the human-run verification in PRODUCTION_QA.md (offline multi-device
sync test, Firestore rules emulator, CI build) + optional `pos-screen.tsx` split
(maintainability, explicitly post-QA).

## Sprint 4 implementation notes

- Added customer and supplier account statement surfaces inside the ledger detail modals.
- Statements are local/offline-first: they are calculated from existing bills, purchases, customer payments, and supplier payments already stored in IndexedDB.
- Statement calculations use opening balance before the selected period, in-period debits/credits, and ending balance.
- Customer statements treat bill totals as sales/debits and cash/card paid at sale plus later customer payments as credits.
- Supplier statements treat purchase totals as purchase/debits and cash/card paid at purchase plus later supplier payments as credits.
- Statement print uses the shared receipt print target (`#receipt-print-area`) and CSV exports respect the selected statement period.
- Old records remain safe: missing invoice numbers, phones, notes, invoice dates, and optional sync fields render as fallbacks rather than throwing.
