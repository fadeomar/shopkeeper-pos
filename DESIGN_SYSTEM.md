# Shopkeeper POS Design System

## 1. Design goals

Create a centralized, consistent, light POS/SaaS interface that is readable, touch-friendly, professional, and safe to migrate without changing business behavior.

## 2. Design principles

- Centralize design decisions in `lib/design` and reusable UI components.
- Prefer calm hierarchy over decorative styling.
- Keep cashier actions clear, large enough, and predictable.
- Use semantic status colors consistently.
- Support English and Arabic RTL naturally with logical CSS utilities such as `start`, `end`, `ms`, and `me`.

## 3. Color system

Retail POS green palette. All colors flow through CSS variables in `app/globals.css (:root)` and are mirrored in `lib/design/tokens.ts`. Use token utilities — never raw Tailwind color scales for brand/status — so a single variable change propagates everywhere.

### Palette table

| Token utility | CSS variable | Hex | Use |
|---|---|---|---|
| `bg-brand` / `text-brand` | `--color-brand` | `#1F6F43` | Primary actions, active nav bar, selected tabs |
| `bg-brand-hover` | `--color-brand-hover` | `#185A35` | Hover state for brand buttons |
| `bg-brand-soft` / `text-brand` | `--color-brand-soft` | `#DCFCE7` | Soft button variant, active tab bg |
| `bg-success` / `text-success` | `--color-success` | `#059669` | Sale completed, paid, synced — kept visually distinct from brand green |
| `bg-success-soft` | `--color-success-soft` | `#D1FAE5` | Success banners, highlight rows |
| `bg-warning` / `text-warning` | `--color-warning` | `#D97706` | Low stock, pending sync, overpayment |
| `bg-warning-soft` | `--color-warning-soft` | `#FED7AA` | Warning banners, conflict badges |
| `bg-danger` / `text-danger` | `--color-danger` | `#DC2626` | Destructive actions, failed sync |
| `bg-danger-soft` | `--color-danger-soft` | `#FEE2E2` | Error banners |
| `bg-info` / `text-info` | `--color-info` | `#2563EB` | Links, info badges, syncing state — kept blue to stay distinct from brand |
| `bg-info-soft` | `--color-info-soft` | `#DBEAFE` | Info banners, syncing badges |
| `bg-money` / `text-money` | `--color-money` | `#B7791F` | Revenue/cash accent (use sparingly) |
| `bg-money-soft` | `--color-money-soft` | `#FEF3C7` | Money-related soft backgrounds |
| `bg-app` | `--color-app` | `#F6F7F2` | Page background (warm tint) |
| `bg-surface` | `--color-surface` | `#FFFFFF` | Cards, panels |
| `bg-surface-soft` | `--color-surface-soft` | `#F0F4EA` | Nested surfaces |
| `bg-surface-muted` | `--color-surface-muted` | `#E4E8DD` | Dividers, chips |
| `border-default` | `--color-border` | `#DDE3D4` | Default card/input border |
| `border-subtle` | `--color-border-subtle` | `#ECF0E5` | Very light dividers |
| `border-strong` | `--color-border-strong` | `#C4CCB6` | Selected/focus states |

### Rules
- **Blue is for info/links only.** Primary actions use `bg-brand`. Never use `bg-blue-*` for buttons.
- **Green comes in two distinct shades:** brand (`#1F6F43`, dark forest) and success (`#059669`, brighter emerald). Don't mix them semantically.
- **Don't use raw Tailwind color scales** (`bg-blue-600`, `text-amber-700`, `text-green-700`, `text-red-600`, `bg-emerald-50`, etc.) in any feature file, shared UI component, auth/provider component, or app page. The color migration is complete across the entire codebase — every status/brand color now uses token utilities.
- `slate-*` classes are acceptable for neutral text and surfaces (grey chrome).
- **Soft surface pattern for status banners:** success → `bg-success-soft border border-success/20 text-success`; danger → `bg-danger-soft border border-danger/20 text-danger`; warning → `bg-warning-soft border border-warning/20 text-warning`; info → `bg-info-soft border border-info/20 text-info`.

## 4. Typography system

Use the app font stack from `globals.css`. Headings should be bold and compact. Body text should be readable at 14–16px. Supporting text should use muted slate tones.

**Fonts are vendored, not fetched.** The three families — Plus Jakarta Sans (`--font-sans`), IBM Plex Sans Arabic (`--font-arabic`), JetBrains Mono (`--font-mono`) — are committed as `.woff2` files under `app/fonts/` and loaded through `next/font/local` in `app/layout.tsx`. This is deliberate: `next/font/google` downloads fonts at **build time**, which breaks offline / air-gapped production builds. Never switch back to `next/font/google`. To refresh or add a weight, edit and re-run `node scripts/vendor-fonts.mjs`, then commit the new files. Plus Jakarta Sans and JetBrains Mono are variable (one file, `weight: '400 800'` / `'400 700'`); IBM Plex Sans Arabic is static (one file per weight, 400–700). Only the `latin` subset is vendored for the Latin families and `arabic` for the Arabic family — keep new strings within those scripts.

## 5. Spacing system

Use spacing from `lib/design/tokens.ts` and the class maps in `variants.ts`. Pages, sections, cards, forms, tables, and toolbars should use shared spacing patterns instead of local one-off values.

## 6. Radius system

Use rounded corners consistently: small controls use rounded-lg/xl, cards and panels use rounded-2xl, and large surfaces may use rounded-3xl.

## 7. Border system

Use subtle borders for cards, inputs, rows, and panels. Strong borders are reserved for selected, warning, danger, or interactive states.

## 8. Shadow system

Use soft shadows only. Avoid heavy shadows except dialogs/modals. Default cards should rely primarily on borders.

## 9. Layout system

Pages should use `PageShell`. Page headings should use `PageHeader`. Sections should use `SectionCard`. Tables should use `TableShell`. Keep horizontal overflow for data tables.

## 10. Button rules

Use `Button` variants from the design system. Primary is for the main action. Secondary/outline are for supporting actions. Danger is for destructive actions. Success may be used for completing sales. Buttons must preserve focus-visible and disabled states.

## 11. Input/form rules

Use `FormField` for labels, hints, errors, and required markers. Inputs and selects must keep a 16px mobile font-size to avoid mobile zoom. Use RTL-safe layouts.

For currency/money amounts use `MoneyInput` (standalone) or `MoneyInputRHF` (react-hook-form Controller). Both live in `components/ui/money-input.tsx`. They wrap `NumberField` with `precision="decimal" decimalScale={2} align="end" inputSize="lg"` and automatically prefix the locale currency symbol from `currencySymbol(currency)` in `lib/utils/money.ts`. Do not use raw `NumberField` with `precision="decimal"` for currency inputs.

For integer quantities use `QuantityStepper` from `components/pos/quantity-stepper.tsx`. It wraps `NumberField` with `showStepper precision="integer" align="center"`. Default width is `w-[160px]`; override with `className` if a narrower fit is needed. Use raw `NumberField precision="integer"` only for signed-delta inputs (e.g. stock adjustments that may be negative).

For payment method selection use `PaymentMethodControl` from `components/pos/payment-method-control.tsx`. It renders a `role="radiogroup"` grid of four `role="radio"` tap cards (Cash, Card, Mixed, Credit). Never use a `SearchableSelect` dropdown for payment method — it requires two taps and is harder to use on mobile. Props: `value: PaymentMethod`, `onChange: (v: PaymentMethod) => void`, `label: string` (pass `t('billing.paymentMethod')`).

For cash tender quick-chips, compute context-aware amounts with `smartCashChips(total)` (defined in `pos-screen.tsx`) instead of hardcoding denominations. The function returns up to 3 amounts that are always ≥ the bill total and formatted with `formatCurrency`.

For picking a counterparty (customer on the POS screen, supplier on the purchase screen) use the **select-sheet** pattern instead of an inline typeahead dropdown. It is built from the shared `Modal` and has three parts: (1) a search `input` filtering the live list by name or normalized phone (sliced to 20), (2) a tap-list of results that calls a `select*` setter and closes the sheet, and (3) a `<details>` "Enter manually" disclosure with name/phone inputs (using `defaultValue` + `onBlur` — safe because `Modal` unmounts its children when closed, so they remount fresh on each open). When a value is selected, the trigger collapses to a chip showing name + phone with a Search (change) and `X` (clear) button; when empty it is a dashed "Select…" button. See `CustomerSelectSheet` in `pos-screen.tsx` and the supplier sheet in `purchase-entry-screen.tsx`. Never reintroduce the focus-tracked floating typeahead — it is fiddly on touch.

Native form controls that paint their own selected state (`<input type="checkbox|radio">`) must use `accent-brand`, never a raw `accent-blue-*`. Their focus ring is `focus:ring-brand` / `focus-visible:ring-brand`, matching every other control. The brand token is green, so checkboxes/radios read as on-brand rather than generic blue.

## 12. Icon rules

Use `lucide-react` icons from the curated barrel in `components/ui/icons.ts`. Never use text symbols as interactive affordances — replace them with icons:

- Close / dismiss buttons → `<X size={16} aria-hidden />` with `aria-label="Close"` on the button
- Remove-item buttons → `<X size={14} aria-hidden />` with `aria-label="Remove"` on the button
- Dropdown chevrons → `<ChevronDown />` / `<ChevronUp />`
- Checkmarks → `<Check />` / `<CircleCheck />`
- Keep `?` for help text, `←`/`→` for directional flow where a text arrow is semantically appropriate

Icons should be `aria-hidden` when they are purely decorative (the surrounding button/label carries the accessible name). Always put the accessible name on the interactive element, not on the icon.

## 13. Card rules

Use `Card` for simple surfaces and `SectionCard` for titled panels. Do not repeat raw `bg-white border border-slate-200 rounded-2xl` across feature files.

## 13. Table rules

Use `TableShell` for table containers, toolbars, loading, and empty states. Headers use small uppercase muted text. Rows should use subtle dividers and hover states.

## 14. Badge/status rules

Use `Badge`, `StatusPill`, and POS-specific status components. Status mappings live in `lib/design/status.ts`.

## 15. Empty/loading/error state rules

Use `EmptyState` and `LoadingState`. Error and warning states should use semantic tone surfaces, not random color combinations.

For transient feedback use the toast system via `useToast().push(message, tone?)` (`components/ui/toast.tsx`). Tone is one of `success | error | info | warning` (defaults to `success`). Each toast is a neutral `bg-surface` card — legible over any page content — with a tone-coloured icon chip (`CircleCheck` / `CircleAlert` / `Info` / `TriangleAlert` in the matching `*-soft` chip), a message, and a tap-to-dismiss `X`. Toasts animate in with `animate-toast-in`; `success`/`info` auto-dismiss after 3s, `error`/`warning` after 5s (longer reading time). The container is `role="status" aria-live="polite"`, sits at `bottom-20` (clearing the mobile bottom nav) and `z-[100]`. Don't build ad-hoc inline notification banners for transient events — use a toast.

## 16. Mobile/touch target rules

Primary POS actions should be at least 44px high. Compact controls may be smaller only when not used as primary touch targets.

## 17. Arabic RTL rules

Do not remove translations or hardcode English where translation keys exist. Use `text-start`, `text-end`, `ms-*`, `me-*`, `start-*`, and `end-*` utilities where possible.

## 18. Offline/sync UI rules

Use centralized sync statuses: online, offline, synced, pendingSync, conflict, and error. Existing domain statuses such as pending, syncing, failed, and blocked should map to semantic tones through `StatusPill` or wrapper components.

Offline route coverage: every route reachable from the nav (sidebar + mobile "More" sheet) must be in the service-worker warm/precache lists so it works offline. Keep `NAV_ROUTES` in `public/sw.js` and `OFFLINE_NAV_ROUTES` in `components/pwa/sw-register.tsx` in sync with the nav, and **bump `CACHE_VERSION` in `sw.js`** whenever the precache list changes so clients pick it up.

## 19. Billing/cart/payment UI rules

Billing UI must not change calculations. Use `PriceDisplay`, `PaymentBadge`, `CartSummaryCard`, and `CheckoutActionBar` as presentational wrappers only.

Settings-driven enforcement (POS + purchases): store settings are authoritative and must actually gate behavior, never be cosmetic toggles. (1) **Payment methods** — `PaymentMethodControl` takes an `available` list derived from `enableCash/enableCard/enableCredit`; `mixed` only appears when both cash and card are on; a disabled method is auto-corrected off the form. (2) **`requireShift`** — a hard block on POS finalize (not just the soft "no shift" banner). (3) **`defaultDiscountLimit`** — a **currency amount** (use `MoneyInputRHF`, not a `%`), caps the POS discount (0 = no limit). (4) **`taxMode`** — only `exclusive` shows the manual tax field (added on top); `none` and `inclusive` hide it and force `taxAmount` to 0. There is no tax-rate engine, so an `inclusive` manual amount would be double-counted — never show it.

These rules are enforced in the UI **and** defensively in the service layer via the shared helpers in `lib/services/settings-policy.ts` — `assertPaymentMethodEnabled(settings, method)` and `effectiveTaxAmount(settings, taxAmount)` — called by both `billing-service.ts` and `purchase-service.ts` so a stale/offline client can't bypass store policy (bad data would otherwise sync to the cloud). `AppError` codes: `BILL_SHIFT_REQUIRED` (bills only), `PAYMENT_METHOD_DISABLED` and `DISCOUNT_EXCEEDS_LIMIT` (shared).

## 20. Inventory/stock UI rules

Use `StockBadge` for stock status display. Do not mutate inventory or stock calculations inside UI display components.

## 21. Migration rules

Migrate one feature at a time. First introduce foundation components, then replace repeated styling. Preserve props, routes, translations, service calls, schemas, and data flow.

## 22. Accessibility (WCAG 2.1 AA) rules

- **Skip-to-content link** — Every shell layout (`CashierShell`, `AdminShell`) must render a visually-hidden `<a href="#main-content">` as its first child, using `sr-only focus:not-sr-only`. The `<main>` must carry `id="main-content"`.
- **Navigation landmarks** — Every `<nav>` must have a unique `aria-label` drawn from i18n (`nav.mainNavLabel`, `nav.adminNavLabel`). Active links must set `aria-current="page"`.
- **Modal dialogs** — Use `role="dialog" aria-modal="true" aria-labelledby={titleId}`. Use `useId()` for `titleId` and `descId` per instance (never hardcoded IDs). Wire `aria-describedby={descId}` when a description is present. The `Modal` component handles this automatically — do not duplicate description text in both the `description` prop and the body children.
- **Combobox / searchable select** — The search input inside `SearchableSelect` must carry `role="combobox" aria-expanded aria-autocomplete="list" aria-controls={listboxId} aria-activedescendant={highlightedOptionId}`. Each option must have a stable `id`.
- **Live regions / toasts** — Toast containers must carry `role="status" aria-live="polite" aria-atomic="false"` so screen readers announce new messages without interrupting.
- **Sortable tables** — Sortable `<th>` elements must set `aria-sort="ascending" | "descending" | "none"`. Pagination must be wrapped in `<nav aria-label={t('dataTable.paginationNav')}>`. Search inputs without a visible `<label>` must have `aria-label`.
- **i18n-only ARIA labels** — All `aria-label` strings must come from translation keys. Never hardcode English in ARIA attributes of shared components.

## 23. Mobile navigation rules

- **Mobile bottom nav (`MobileBottomNav`)** — fixed bottom tab bar (`lg:hidden`) with 4 primary POS tabs (Sell, Bills, Products, Stock) plus a "More" sheet for the remaining 10 routes. This is the authoritative mobile navigation for `CashierShell`.
- **Desktop sidebar nav (`SidebarNav`)** — `hidden lg:flex` — handles desktop-only vertical navigation. Do not add mobile presentation to this component.
- **Routing tabs are not configurable per-role** in the current implementation. All cashier routes are listed. Permission-gated pages (e.g., Reports, Audit) are still visible in navigation but show a restricted view if the user lacks access — this is intentional and consistent with the desktop sidebar.
- **More sheet close on navigate**: `MobileBottomNav` closes the sheet automatically when `pathname` changes. Don't add manual close logic to individual links inside the sheet.
- **Bottom nav hidden on `/billing`**: `MobileBottomNav` returns `null` when `pathname.startsWith("/billing")`. The POS Sell screen owns the bottom of the viewport with its sticky checkout bar — the nav would overlap it. Do not remove this guard.
- **Bottom nav z-index is `z-40`**; the More sheet overlay is `z-50`. Toasts are `z-[100]`. Modals are `z-50`. This ordering is intentional — modals and toasts always appear above the bottom nav.

## 24. Rules for what must not be changed during UI refactors

Do not change business logic, billing calculations, payment logic, stock/inventory calculations, Firebase sync, IndexedDB/local/offline logic, database schemas, routes, Arabic/RTL support, translations, or existing offline behavior.
