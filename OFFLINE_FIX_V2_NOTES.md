# Offline fix v2

This version fixes the case where Chrome shows its own dinosaur offline page after Wi-Fi/mobile data are turned off.

Root cause: the previous service worker installed route caches during the install event. On a phone through a Cloudflare tunnel, one slow route can keep the worker in the installing state. If the worker is not active/controlling the page, Chrome handles the offline navigation itself and shows ERR_INTERNET_DISCONNECTED.

Changes:

- Service worker install no longer waits for network route warm-up.
- The client reloads once after first service-worker control so the tab is definitely controlled before offline testing.
- The cache badge only says ready after required routes are present in Cache Storage.
- Offline route warming is retried from the client after the worker is active.
- Route warm-up fetches have a timeout so one hanging request cannot block cache preparation.

Testing rule: do not turn the internet off until the top badge says "Offline cache ready" after the automatic one-time reload.
