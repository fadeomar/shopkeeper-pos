# Shopkeeper POS — Claude Code context

## What this project is

An offline-first point-of-sale PWA for small retail shops. Built with Next.js App Router (React 19), Tailwind v4, Dexie (IndexedDB) for local storage, and Firebase Firestore for cloud sync. Supports English and Arabic (RTL). Multi-user with role-based permissions managed in Firebase.

---

## Key commands

```bash
npm run dev              # dev server (no service worker)
npm run dev:offline      # dev with offline PWA service worker enabled
npm run typecheck        # tsc --noEmit --noUnusedLocals --noUnusedParameters (matches CI) ← run after every edit
npm run build            # production build
npm run preview:offline  # build + serve with offline SW
npm test                 # vitest: unit + integration + components
npm run deploy:rules     # deploy firestore.rules to Firebase (see warning below)
```

`npm run typecheck` mirrors CI's exact flags — CI also rejects unused locals/params,
so an edit that only `tsc --noEmit`-passes can still fail CI without these.

> ⚠️ **Firestore rules deploy SEPARATELY from the app.** Merging to `main` and the
> Vercel deploy do **not** update `firestore.rules` in the Firebase project — the
> live rules stay stale until you run `npm run deploy:rules` (or
> `firebase deploy --only firestore:rules`). Any change to `firestore.rules` is
> only live after that step. (A stale rules deploy once blocked the new
> `administration` role from reading `/users` in production.)

### Admin/ops scripts

`npm run deploy:rules` and `npm run plan:permissions-migration` authenticate with
the app's own `FIREBASE_ADMIN_*` service-account env vars (shared resolver in
`scripts/lib/admin-credentials.mjs`). Get them locally with
`vercel env pull .env.local`; the npm scripts load it via `--env-file-if-exists`.
Avoid downloading raw service-account JSON keys — they're long-lived secrets.
`GOOGLE_APPLICATION_CREDENTIALS` (a JSON key path) is still honored as a fallback.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16, React 19, App Router |
| Styling | Tailwind v4 (CSS-variable token system) |
| Local DB | Dexie v4 (IndexedDB) — offline-first, all reads/writes go here |
| Cloud sync | Firebase Firestore (persistent local cache, background sync) |
| Auth | Firebase Authentication |
| Forms | react-hook-form v7 + zod v3 |
| Tables | @tanstack/react-table v8 |
| Icons | lucide-react (curated barrel at `components/ui/icons.ts`) |
| Barcodes | @zxing/browser + @zxing/library |
| i18n | Custom (lib/i18n) — English (`en.ts`) + Arabic (`ar.ts`) |

---

## Architecture in one paragraph

Every user action writes to **Dexie first** (IndexedDB, always available offline). A background `SyncProvider` watches the Dexie `syncQueue` table and pushes changes to Firestore when online. On first load or sign-in it pulls the user's cloud data down into Dexie. The UI reads from Dexie via `useLiveQuery` hooks — it never calls Firebase directly. This means the app works fully offline and syncs opportunistically.

---

## Directory map

```
app/                    Next.js App Router pages (routes only — no business logic)
  admin/users/          Admin user-management pages (Firebase Admin SDK)
  billing/              POS checkout page
  bills/[billId]/       Bill detail + receipt view
  reports/, reports/z/  Sales reports + Z-report
  [all others]          One page per feature

features/               Feature-scoped components + utils (no routing)
  bills/                POS screen, bills table, bill details, receipt
  products/             Product list, form, import/export
  purchases/            Purchase entry screen
  inventory/            Stock-count workspace
  customers/            Customer ledger
  suppliers/            Supplier ledger
  cash/                 Cash movement log
  expenses/             Expense log
  shift/                Shift open/close + shift report
  reports/              Sales dashboard + Z-report
  audit/                Audit event log

lib/
  db/schema.ts          Dexie database definition — ALL tables and versions here
  db/repositories.ts    Low-level Dexie query helpers
  services/             Business logic — billing, inventory, sync, etc.
  firebase/             All Firebase interactions (auth, sync, admin, restore)
  i18n/                 Translation strings (en.ts, ar.ts) + type definitions
  design/               tokens.ts, variants.ts, status.ts — design system values
  utils/                Pure helpers (money, date, id, csv, calculations, …)
  hooks/                use-permissions.ts — role-based permission checks
  errors/               Typed error classes + user-facing message helper

components/
  ui/                   Generic design-system components
  pos/                  POS-specific display components (PriceDisplay, etc.)
  providers/            React context providers (auth, settings, locale, sync)
  auth/                 AuthenticatedShell (auth gate + sidebar layout)
  sync/                 SyncStatusBadge, ConflictResolverModal
  barcode/              BarcodeScannerModal
  sidebar-nav.tsx       Left navigation
  pwa/sw-register.tsx   Service worker registration (debug overlay — dark themed)

types/domain.ts         All TypeScript entity types (Bill, Product, Customer, …)
```

---

## What must NEVER be changed during UI work

These files are off-limits unless the task is explicitly about the business logic or data layer:

```
lib/services/**         Business logic (billing, inventory, sync, etc.)
lib/db/**               Schema, migrations, repositories
lib/firebase/**         Cloud sync, auth, admin
lib/i18n/**             Translation strings and types
firestore.rules         Security rules
types/domain.ts         Domain entity types
components/ui/number-field.tsx      Numeric input primitive (complex, stable)
components/pos/quantity-stepper.tsx Quantity stepper primitive
```

> **Rule:** If a change doesn't affect what the user sees, it doesn't belong in a UI refactor.

---

## Design system

Tokens live in `lib/design/tokens.ts` and are exposed as CSS custom properties in `app/globals.css (:root)`, then mapped to Tailwind utilities via `@theme inline`. Full reference: `DESIGN_SYSTEM.md`.

### Never use raw Tailwind color scales for status/brand

Always use the semantic token utilities:

| Intent | Use |
|---|---|
| Primary action / active nav | `bg-brand`, `text-brand` |
| Sale completed, synced, paid, positive | `bg-success`, `bg-success-soft`, `text-success` |
| Low stock, pending, warning | `bg-warning`, `bg-warning-soft`, `text-warning` |
| Error, destructive, failed, debt | `bg-danger`, `bg-danger-soft`, `text-danger` |
| Links, info badges, syncing | `bg-info`, `bg-info-soft`, `text-info` |
| Neutral text / surfaces | `slate-*` (still acceptable) |

**Never use:** `bg-red-*`, `text-green-*`, `bg-emerald-*`, `text-amber-*`, `bg-blue-*` (except in the intentional dark-overlay debug UI in `sw-register.tsx`).

### Banner / alert pattern

```tsx
// success
<div className="rounded-xl bg-success-soft border border-success/20 px-4 py-3 text-sm text-success">
// danger
<div className="rounded-xl bg-danger-soft border border-danger/20 px-4 py-3 text-sm text-danger">
// warning
<div className="rounded-xl bg-warning-soft border border-warning/20 px-4 py-3 text-sm text-warning">
```

### Money inputs

Use `MoneyInput` (standalone) or `MoneyInputRHF` (react-hook-form) from `components/ui/money-input.tsx`. Pass `currency` (e.g. `"ILS"`). Do **not** use raw `NumberField` with `precision="decimal"` for currency.

### Quantity inputs

Use `QuantityStepper` from `components/pos/quantity-stepper.tsx` for non-negative integer quantities. API: `value: number`, `onChange: (v: number) => void`, optional `min`, `max`, `className`. Use raw `NumberField precision="integer"` only when the delta can be negative (e.g. stock adjustments).

### Icons

Use lucide-react from the curated barrel at `components/ui/icons.ts`. Don't use text symbols as interactive affordances — use `<X />`, `<ChevronDown />`, `<Check />`, etc. with `aria-hidden` and `aria-label` on the parent button.

---

## i18n rules

- Every user-visible string must use `const { t } = useLocale()` and a key from `lib/i18n/en.ts` / `lib/i18n/ar.ts`.
- **Never hardcode English strings** in component JSX.
- Adding a new string: add the key to both `en.ts` and `ar.ts` simultaneously.
- RTL: use logical CSS utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `text-end`, `start-*`, `end-*`) — never `ml-*`, `mr-*`, `pl-*`, `pr-*`, `text-left`, `text-right`.

---

## Data flow patterns

### Reading data (live, reactive)
```tsx
const products = useLiveQuery(() => db.products.orderBy('name').toArray(), []);
const settings = useLiveQuery(() => settingsRepo.get(), []);
```
`useLiveQuery` re-runs automatically when the queried table changes.

### Writing data (always via service layer)
```tsx
import { createProductWithInitialMovement } from '@/lib/services/inventory-service';
await createProductWithInitialMovement(product); // handles stock movement + audit
```
Never write to `db.*` directly from feature components — always go through `lib/services/`.

### Form pattern (react-hook-form + zod)
```tsx
const form = useForm<MySchema>({ resolver: zodResolver(mySchema) });
// Controlled fields use Controller or NumberFieldRHF / MoneyInputRHF
// Native inputs use form.register(...)
```

---

## Permissions

```tsx
const { canEditCost, canViewProfit, canVoidBills, isAdmin, isCashier } = usePermissions();
```
Defined in `lib/hooks/use-permissions.ts`. Role is stored in Firebase and cached locally. UI should hide/disable features the current user can't access — never rely on UI-only guards for security (server rules enforce this).

---

## Environment variables

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

See `.env.local.example`. Admin API routes also use Firebase Admin SDK credentials (server-side only).

---

## Key files to know

| File | Why it matters |
|---|---|
| `lib/db/schema.ts` | Single source of truth for all Dexie tables and migrations |
| `types/domain.ts` | All entity TypeScript types — read before touching any data shape |
| `lib/i18n/en.ts` | All translation keys — check here before adding new UI text |
| `app/globals.css` | CSS token definitions + Tailwind `@theme inline` block |
| `lib/design/tokens.ts` | Token values mirrored from globals.css — keep in sync |
| `DESIGN_SYSTEM.md` | Full design system rules (color, typography, components) |
| `REFACTOR_NOTES.md` | History of what changed in each refactor phase |

---

## Common gotchas

- **`useLiveQuery` returns `undefined` on first render** — always guard with `if (!data) return <Loading />`.
- **`QuantityStepper` API:** `onChange` (not `onValueChange`), `value: number` (not nullable). If state is `number | null`, pass `value={quantity ?? 0}`.
- **`MoneyInputRHF`** uses a `Controller` internally — don't also wrap it in `Controller`.
- **Barcode uniqueness** is enforced at the UI layer in `product-form.tsx` before saving — not a DB constraint.
- **`syncStatus`** on entities defaults to `"pending"` at creation. The sync service handles transitions. Don't manually set `"synced"`.
- **Admin pages** (`app/admin/`) use Firebase Admin SDK via an API route — they require a server environment and won't work in static export mode.
- **`sw-register.tsx`** uses intentional dark-overlay colors (`green-900`, `red-900`, `blue-900`) — do not token-ize these; they are a developer debug panel with a deliberately dark theme.
