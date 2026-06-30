import { expect, test } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from './helpers/auth';
import {
  isOfflineNotReadyScreenShowing,
  waitForOfflineCacheReady,
  goOffline,
  goOnline,
} from './helpers/pwa';

// Guards the production P0: a fresh browser, with the service worker installed
// and controlling the page, must boot online into the app and must NEVER show
// the synthetic "Offline cache is not ready yet" screen while online — even
// across the post-install control reload.
test.describe('production PWA online boot readiness', () => {
  test('online first boot reaches the store and never shows the offline-cache-not-ready screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-desktop-chrome', 'online boot contract runs once on desktop');

    await loginAsOwner(page, { uid: 'e2e-pwa-online-boot' });
    await page.goto('/');

    // Reaches the app while online.
    await expect(page.getByRole('link', { name: /create.*bill/i })).toBeVisible();
    expect(await isOfflineNotReadyScreenShowing(page)).toBe(false);

    // Let the service worker take control + warm the cache. The control reload
    // is the moment the old build stranded online users on the offline screen.
    await waitForOfflineCacheReady(page);

    await expect(page.getByRole('link', { name: /create.*bill/i })).toBeVisible();
    expect(await isOfflineNotReadyScreenShowing(page)).toBe(false);

    // A normal online reload (now SW-controlled) must still serve the app.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /create.*bill/i })).toBeVisible();
    expect(await isOfflineNotReadyScreenShowing(page)).toBe(false);
  });

  test('offline fallback only appears after going offline once the app shell is cached', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-desktop-chrome', 'offline-readiness contract runs once on desktop');

    await loginAsOwner(page, { uid: 'e2e-pwa-offline-readiness' });
    await initializeDemoData(page);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();

    // Regression #6: only go offline AFTER the shell is cached.
    await waitForOfflineCacheReady(page);
    expect(await isOfflineNotReadyScreenShowing(page)).toBe(false);

    await goOffline(context, page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Cached → the real screen renders offline; the not-ready screen must not.
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();
    expect(await isOfflineNotReadyScreenShowing(page)).toBe(false);

    await goOnline(context, page);
  });
});
