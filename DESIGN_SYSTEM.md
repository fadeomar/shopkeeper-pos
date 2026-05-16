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

Use a soft slate/blue palette with white cards and subtle borders. Status colors are reserved for meaning: success, warning, danger, info, and neutral. Do not invent random green/red/yellow classes in feature pages.

## 4. Typography system

Use the app font stack from `globals.css`. Headings should be bold and compact. Body text should be readable at 14–16px. Supporting text should use muted slate tones.

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

## 12. Card rules

Use `Card` for simple surfaces and `SectionCard` for titled panels. Do not repeat raw `bg-white border border-slate-200 rounded-2xl` across feature files.

## 13. Table rules

Use `TableShell` for table containers, toolbars, loading, and empty states. Headers use small uppercase muted text. Rows should use subtle dividers and hover states.

## 14. Badge/status rules

Use `Badge`, `StatusPill`, and POS-specific status components. Status mappings live in `lib/design/status.ts`.

## 15. Empty/loading/error state rules

Use `EmptyState` and `LoadingState`. Error and warning states should use semantic tone surfaces, not random color combinations.

## 16. Mobile/touch target rules

Primary POS actions should be at least 44px high. Compact controls may be smaller only when not used as primary touch targets.

## 17. Arabic RTL rules

Do not remove translations or hardcode English where translation keys exist. Use `text-start`, `text-end`, `ms-*`, `me-*`, `start-*`, and `end-*` utilities where possible.

## 18. Offline/sync UI rules

Use centralized sync statuses: online, offline, synced, pendingSync, conflict, and error. Existing domain statuses such as pending, syncing, failed, and blocked should map to semantic tones through `StatusPill` or wrapper components.

## 19. Billing/cart/payment UI rules

Billing UI must not change calculations. Use `PriceDisplay`, `PaymentBadge`, `CartSummaryCard`, and `CheckoutActionBar` as presentational wrappers only.

## 20. Inventory/stock UI rules

Use `StockBadge` for stock status display. Do not mutate inventory or stock calculations inside UI display components.

## 21. Migration rules

Migrate one feature at a time. First introduce foundation components, then replace repeated styling. Preserve props, routes, translations, service calls, schemas, and data flow.

## 22. Rules for what must not be changed during UI refactors

Do not change business logic, billing calculations, payment logic, stock/inventory calculations, Firebase sync, IndexedDB/local/offline logic, database schemas, routes, Arabic/RTL support, translations, or existing offline behavior.
