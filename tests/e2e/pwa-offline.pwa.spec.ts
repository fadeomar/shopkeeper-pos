import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from './helpers/auth';
import {
  expectActiveSyncCountAtLeast,
  getStoreCount,
  goOffline,
  goOnline,
  waitForActiveSyncCount,
  waitForRouteCached,
  waitForServiceWorkerControl,
} from './helpers/pwa';

async function addProductToBill(page: Page, productName = 'Milk 1L') {
  await page.getByRole('button', { name: /select product/i }).first().click();
  await page.getByRole('combobox', { name: /search by name/i }).fill(productName);
  await page.getByRole('option', { name: new RegExp(productName, 'i') }).click();
  await expect(page.getByText(productName).filter({ visible: true }).first()).toBeVisible();
}

async function finalizeBill(page: Page) {
  await page.getByRole('button', { name: /review & finalize/i }).last().click();
  const dialog = page.getByRole('dialog', { name: /finalize bill/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /confirm save/i }).click();
  await expect(page.getByText(/sale completed/i).first()).toBeVisible();
}

test.describe('production PWA offline behavior', () => {
  test('desktop cashier can reload billing offline, save a cash sale, and sync after reconnect', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-desktop-chrome', 'full offline-save-sync flow runs once on desktop');

    await loginAsOwner(page, { uid: 'e2e-pwa-desktop-cashier' });
    await initializeDemoData(page);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();

    await waitForServiceWorkerControl(page);
    await waitForRouteCached(page, '/billing');
    await waitForActiveSyncCount(page, 0, 30_000);

    const billsBefore = await getStoreCount(page, 'bills');

    await goOffline(context, page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();
    await expect(page.getByText('Offline mode active').first()).toBeVisible();

    await addProductToBill(page, 'Milk 1L');
    await finalizeBill(page);
    await expectActiveSyncCountAtLeast(page, 1);
    await expect.poll(async () => getStoreCount(page, 'bills')).toBeGreaterThan(billsBefore);

    await goOnline(context, page);
    await page.evaluate(() => window.dispatchEvent(new Event('shopkeeper:sync-requested')));
    await waitForActiveSyncCount(page, 0, 30_000);
  });

  test('mobile cashier can reload the cached billing screen offline and reach finalize review', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-mobile-chrome', 'mobile-only PWA smoke test');

    await loginAsOwner(page, { uid: 'e2e-pwa-mobile-cashier' });
    await initializeDemoData(page);
    await page.goto('/billing');
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();

    await waitForServiceWorkerControl(page);
    await waitForRouteCached(page, '/billing');
    await waitForActiveSyncCount(page, 0, 30_000);

    await goOffline(context, page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /create bill/i })).toBeVisible();

    await addProductToBill(page, 'Milk 1L');
    await expect(page.getByRole('button', { name: /review & finalize/i }).last()).toBeVisible();
    await page.getByRole('button', { name: /review & finalize/i }).last().click();
    await expect(page.getByRole('dialog', { name: /finalize bill/i })).toBeVisible();

    await goOnline(context, page);
  });
});
