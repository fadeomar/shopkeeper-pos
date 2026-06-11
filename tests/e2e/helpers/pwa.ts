import { expect, type BrowserContext, type Page } from '@playwright/test';

const ACTIVE_SYNC_STATUSES = ['pending', 'failed', 'syncing', 'conflict', 'blocked'];

export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) return false;
          try {
            await navigator.serviceWorker.ready;
          } catch {
            return false;
          }
          return Boolean(navigator.serviceWorker.controller);
        }),
      { timeout: 45_000, message: 'service worker should control the PWA page' },
    )
    .toBe(true);
}

export async function isRouteCached(page: Page, route: string): Promise<boolean> {
  return page.evaluate(async (routeToCheck) => {
    if (!('caches' in window)) return false;
    const absolute = new URL(routeToCheck, window.location.origin).toString();
    return Boolean(
      (await caches.match(absolute, { ignoreSearch: true })) ||
        (await caches.match(routeToCheck, { ignoreSearch: true })),
    );
  }, route);
}

export async function waitForRouteCached(page: Page, route: string): Promise<void> {
  await expect
    .poll(async () => isRouteCached(page, route), {
      timeout: 45_000,
      message: `${route} should be available in the service-worker cache`,
    })
    .toBe(true);
}

async function readStoreRows(page: Page, storeName: string): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((store) => {
    return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
      const openReq = indexedDB.open('shopkeeper-pos-db');
      openReq.onerror = () => reject(openReq.error ?? new Error(`Could not open IndexedDB for ${store}`));
      openReq.onsuccess = () => {
        const database = openReq.result;
        if (!database.objectStoreNames.contains(store)) {
          database.close();
          resolve([]);
          return;
        }

        const tx = database.transaction(store, 'readonly');
        const getAllReq = tx.objectStore(store).getAll();
        getAllReq.onerror = () => {
          database.close();
          reject(getAllReq.error ?? new Error(`Could not read ${store}`));
        };
        getAllReq.onsuccess = () => {
          const rows = getAllReq.result as Array<Record<string, unknown>>;
          database.close();
          resolve(rows);
        };
      };
    });
  }, storeName);
}

export async function getActiveSyncCount(page: Page): Promise<number> {
  const rows = await readStoreRows(page, 'syncQueue');
  return rows.filter((row) => ACTIVE_SYNC_STATUSES.includes(String(row.status))).length;
}

export async function getStoreCount(page: Page, storeName: string): Promise<number> {
  const rows = await readStoreRows(page, storeName);
  return rows.length;
}

export async function waitForActiveSyncCount(page: Page, expected: number, timeout = 20_000): Promise<void> {
  await expect
    .poll(async () => getActiveSyncCount(page), {
      timeout,
      message: `active sync queue count should become ${expected}`,
    })
    .toBe(expected);
}

export async function expectActiveSyncCountAtLeast(page: Page, minimum: number): Promise<void> {
  await expect
    .poll(async () => getActiveSyncCount(page), {
      timeout: 10_000,
      message: `active sync queue count should be at least ${minimum}`,
    })
    .toBeGreaterThanOrEqual(minimum);
}

export async function goOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText(/^offline$/i).first()).toBeVisible({ timeout: 10_000 });
}

export async function goOnline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText(/^online$/i).first()).toBeVisible({ timeout: 10_000 });
}
