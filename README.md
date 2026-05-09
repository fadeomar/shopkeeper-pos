# Shopkeeper POS - Offline First Supermarket / POS / Inventory App

A production-minded frontend-first supermarket and inventory management starter built with Next.js App Router, TypeScript, IndexedDB, and a custom PWA setup.

## Why this architecture

- **IndexedDB is the source of truth** via Dexie.
- **Products are mutable live inventory.**
- **Bills and bill items are immutable snapshots.**
- **Stock movements create an audit trail** for every stock-affecting action.
- **No backend dependency** for version 1.
- **JSON is reserved for future manual backup/import/export**, not live storage.

## Main business guarantees

1. Product edits never rewrite historical bills.
2. Finalized bills cannot be edited.
3. Bill items store product snapshot fields at sale time.
4. Live stock is reduced only through the billing workflow or adjustments.
5. Profit calculations come from saved snapshot prices, not current catalog data.

## Tech stack

- Next.js App Router
- TypeScript
- Dexie + IndexedDB
- React Hook Form + Zod
- Custom PWA manifest + service worker registration

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

Normal `npm run dev` intentionally disables the service worker so stale dev
chunks do not get stuck in the browser.

## Offline / PWA testing

### Why `npm run dev` is not the right test environment

The service worker is disabled in development to prevent stale JS chunks from
breaking hot-module reloading. Production build is the authoritative offline
test.

### Desktop production test (required before shipping)

```bash
npm run build
npm run start
```

1. Open `http://localhost:3000` in Chrome.
2. Log in and visit `/`, `/products`, `/billing`, `/bills`, `/settings`.
3. Open **DevTools → Application → Service Workers**.
   - Confirm `/sw.js` shows **Status: activated and is running**.
   - Confirm it is **controlling** the current page.
4. Open **Application → Cache Storage**.
   - Confirm `sk-pages-*` cache contains route shells.
   - Confirm `sk-static-*` cache contains `/_next/static/` chunks.
5. Go to **Network → check "Offline"** (or use the Offline preset).
6. Refresh each of the five routes — none should show the browser default
   offline page.
7. Create a bill while offline. Refresh offline. Bill must still appear.
8. Go back online. Confirm the "pending sync" badge in the top bar clears as
   the sync engine flushes the queue.

### Development SW test (experimental, not a substitute for production)

```bash
npm run dev:offline
```

`NEXT_PUBLIC_ENABLE_OFFLINE_SW=1` opts the dev server back into the service
worker. Note that `sw.js?dev-sw=1` is registered in this mode. This is useful
for quick iteration on SW logic but the production build remains the source of
truth.

### Mobile HTTPS test

**Do not rely on `http://192.168.x.x:3000` as the final PWA test.** Mobile
browsers require a secure context (HTTPS) for service workers. HTTP on LAN is
only reliable for `localhost` on the same device.

Use an HTTPS tunnel instead:

```bash
# Option A — ngrok
ngrok http 3000

# Option B — Cloudflare tunnel
cloudflared tunnel --url http://localhost:3000
```

Open the HTTPS URL on the phone, load the app online, then:
- Enable airplane mode (or disable Wi-Fi + mobile data).
- Refresh and navigate — the app must stay functional from IndexedDB.
- Re-enable network — pending sync jobs must complete.

You can start the server accessible over LAN (for non-PWA debugging) with:

```bash
npm run start:host   # binds to 0.0.0.0 — use http://YOUR_LAN_IP:3000
```

### Clearing old SW / caches between test runs

1. Chrome DevTools → **Application → Service Workers** → **Unregister**.
2. **Application → Storage → Clear site data** (uncheck IndexedDB if you want
   to keep local bills/products).
3. Reload the app while online before testing offline behaviour again.

### Sync queue behaviour

- Bills and products created or modified while offline are saved locally
  **immediately** and marked `syncStatus: 'pending'`.
- The top status bar shows a "N pending sync" badge while jobs are queued.
- On reconnect (or on next app open while online) the `SyncProvider` processes
  all pending / failed jobs in sequence.
- Jobs that fail (e.g. auth expired) are marked `failed` and retried on the
  next reconnect, up to 5 attempts.
- Retrying a bill sync uses `setDoc` on the same document ID — idempotent, no
  duplicate bills created in Firestore.

## PWA notes

- Manifest is served from `app/manifest.ts`.
- Service worker file is in `public/sw.js`.
- Registration happens client-side in `components/pwa/sw-register.tsx`.
- The app is designed so core UX keeps working offline after first load.

## Seed data

Use the **Initialize Demo Data** action on the dashboard to populate products, bills, bill items, settings, and stock movement history for testing.

## Current structure

- `app/` routes and app shell
- `components/` shared UI and PWA helpers
- `features/products/` product forms, table, validation
- `features/bills/` POS flow, bill history, detail screen, validation
- `features/inventory/` stock adjustment UI
- `lib/db/` Dexie database, repositories, seed helpers
- `lib/services/` billing and inventory business logic
- `lib/utils/` helpers for ids, dates, money, backup planning
- `types/` core domain models

## Future-ready areas intentionally prepared

- JSON backup/export/import orchestration
- barcode scanner input hooks
- returns / refunds
- customers / suppliers
- dashboard analytics
- server sync / multi-device sync

## Important implementation decision

The `createFinalizedBill()` service is the key business boundary. It:

1. Validates stock from live products.
2. Creates immutable bill item snapshots.
3. Calculates totals and profit.
4. Deducts live stock.
5. Writes stock movement records.
6. Saves the finalized bill in one Dexie transaction.

That service should remain the only place that final sale writes happen.


## v2 improvements included

- Bill finalization now re-reads and validates live stock inside a single IndexedDB transaction before writing immutable bill records.
- Product edit no longer changes live stock silently. Stock changes must go through stock adjustment so the audit trail stays complete.
- POS draft is persisted locally in browser storage to reduce accidental data loss on refresh.
- Browser prompt and confirm dialogs were replaced with in-app modal flows for stock adjustment and bill finalization.
- Added a settings page for store-level defaults and validation behavior.
- PWA service worker caching was expanded and the app now shows visible offline readiness status.

## Core accounting rules

- Products are mutable live inventory records.
- Bills and bill items are immutable historical records.
- Bill details must always render from bill snapshots, never from current product fields.
- Every stock quantity change should have a stock movement entry.
- Product quantity editing is intentionally separated from product detail editing.
