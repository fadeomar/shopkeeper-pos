# Offline mode fix notes

## Root causes found

1. Normal `npm run dev` unregisters the service worker and deletes all `sk-*` caches.
   This is intentional for development, but it means a phone connected through a Cloudflare tunnel will not have real offline mode unless the server is started with `NEXT_PUBLIC_ENABLE_OFFLINE_SW=1` or with a production build.

2. Offline App Router navigation could leave the app in a corrupted visual state.
   When a `next/link` navigation failed to fetch RSC data, the service worker posted `SK_OFFLINE_NAV`, but the client only hard-navigated when `navigator.onLine === false`. Phones can still report online while the app origin is unreachable. Result: URL/sidebar changed to Settings or Sell, but the old Dashboard content stayed visible.

3. The HTML fallback served `/` when the requested route was not cached.
   In Next App Router, serving the Dashboard HTML for `/settings` paints Dashboard content while the URL is `/settings`. The service worker now returns the exact cached route or a clear offline-cache error instead of silently showing the wrong page.

4. Route warming was only best-effort during service-worker install.
   The client now asks the active worker to warm all critical routes (`/billing`, `/bills`, `/products`, `/settings`, etc.) whenever the worker is ready and whenever the app comes back online.

## Files changed

- `public/sw.js`
  - bumped cache version to `0.1.9`
  - added `WARM_ROUTES`
  - removed the misleading `/` fallback for non-root routes
  - added stronger route/static cache warming

- `components/pwa/sw-register.tsx`
  - always hard-navigates on `SK_OFFLINE_NAV`
  - intercepts same-origin route clicks while clearly offline and uses full document navigation
  - warms critical routes after service worker activation and on reconnect

- `lib/services/billing-service.ts`
  - dispatches `shopkeeper:sync-requested` after a bill is saved, so online bill creation syncs immediately instead of waiting for a reconnect/reload

- `package.json`
  - added `dev:offline:host`
  - added `preview:offline`

## Required test command

For the strongest test, use production mode:

```bash
npm ci
npm run preview:offline
```

Then expose it with the same Cloudflare tunnel URL for the whole test session:

```bash
cloudflared tunnel --url http://localhost:3000
```

Do not change the Cloudflare URL mid-test. A new tunnel hostname is a new browser origin with a new service worker and empty Cache Storage.

For quick development testing only:

```bash
npm run dev:offline:host
cloudflared tunnel --url http://localhost:3000
```

## Clean start on the phone

Before testing this patch, clear only the web-app cache, not necessarily IndexedDB business data:

1. Open the app online.
2. Go to Settings -> Device health -> Clear cache & reload.
3. If the phone still behaves strangely, in Chrome DevTools remote debugging use Application -> Service Workers -> Unregister, then Application -> Cache Storage -> delete `sk-*` caches.
4. Reload online and wait until the top badge says cache ready.

## Acceptance test

1. Open the app online on the phone using one stable HTTPS tunnel URL.
2. Login as the cashier.
3. Visit `/billing`, `/bills`, `/products`, `/settings`, and back to `/billing` once while online.
4. Confirm the top badge says cache ready.
5. Turn off Wi-Fi and mobile data, or use airplane mode.
6. On `/billing`, add an existing product to the bill.
7. Finalize the bill.
8. Confirm the bill is saved and the top badge shows pending sync.
9. While still offline, navigate to Settings, Products, Bills, and Sell.
10. Confirm every tab shows its own page, not Dashboard.
11. Add one new product while offline.
12. Return to Sell and create a second bill with that product if stock is available.
13. Re-enable network.
14. Confirm pending sync count goes down to zero.
15. Refresh the page online, then offline refresh `/billing` and `/bills`; both should load.

## Expected failure mode after the patch

If a route was genuinely never cached, the app should show a clear "This page is not cached yet" screen. It should not show Dashboard content under a different active tab.
