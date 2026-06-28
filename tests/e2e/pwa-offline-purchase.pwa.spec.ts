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

async function addProductToPurchase(page: Page, productName = 'Rice 5kg') {
  await page.getByRole('button', { name: /select product to add/i }).click();
  await page.getByRole('combobox', { name: /search by name/i }).fill(productName);
  await page.getByRole('option', { name: new RegExp(productName, 'i') }).click();
  await expect(page.getByRole('button', { name: /add item/i })).toBeEnabled();
  await page.getByRole('button', { name: /add item/i }).click();
  await expect(page.getByText(productName).first()).toBeVisible();
}

async function finalizePurchase(page: Page) {
  await page.getByRole('button', { name: /review & save/i }).last().click();
  const dialog = page.getByRole('dialog', { name: /finalize purchase/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /confirm save/i }).click();
  await expect(page.getByText(/purchase saved/i).first()).toBeVisible();
}

test.describe('production PWA offline purchase behavior', () => {
  test('desktop cashier can reload purchases offline, save a cash purchase, and sync after reconnect', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-desktop-chrome', 'full offline purchase sync flow runs once on desktop');

    await loginAsOwner(page, { uid: 'e2e-pwa-desktop-purchase-cashier' });
    await initializeDemoData(page);
    await page.goto('/purchases/new');
    await expect(page.getByRole('heading', { name: /new purchase/i })).toBeVisible();

    await waitForServiceWorkerControl(page);
    await waitForRouteCached(page, '/purchases/new');
    await waitForActiveSyncCount(page, 0, 30_000);

    const purchasesBefore = await getStoreCount(page, 'purchases');

    await goOffline(context, page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /new purchase/i })).toBeVisible();
    await expect(page.getByText(/^offline$/i).first()).toBeVisible();

    await addProductToPurchase(page, 'Rice 5kg');
    await finalizePurchase(page);
    await expectActiveSyncCountAtLeast(page, 1);
    await expect.poll(async () => getStoreCount(page, 'purchases')).toBeGreaterThan(purchasesBefore);

    await goOnline(context, page);
    await page.evaluate(() => window.dispatchEvent(new Event('shopkeeper:sync-requested')));
    await waitForActiveSyncCount(page, 0, 30_000);
  });

  test('mobile cashier can reload cached purchase screen offline and reach save review', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'pwa-mobile-chrome', 'mobile-only PWA purchase smoke test');

    await loginAsOwner(page, { uid: 'e2e-pwa-mobile-purchase-cashier' });
    await initializeDemoData(page);
    await page.goto('/purchases/new');
    await expect(page.getByRole('heading', { name: /new purchase/i })).toBeVisible();

    await waitForServiceWorkerControl(page);
    await waitForRouteCached(page, '/purchases/new');
    await waitForActiveSyncCount(page, 0, 30_000);

    await goOffline(context, page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /new purchase/i })).toBeVisible();

    await addProductToPurchase(page, 'Rice 5kg');
    await expect(page.getByRole('button', { name: /review & save/i }).last()).toBeVisible();
    await page.getByRole('button', { name: /review & save/i }).last().click();
    await expect(page.getByRole('dialog', { name: /finalize purchase/i })).toBeVisible();

    await goOnline(context, page);
  });
});
