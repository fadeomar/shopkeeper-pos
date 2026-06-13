import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsCashier } from './helpers/auth';

async function addProductToPurchase(page: Page, productName = 'Rice 5kg') {
  await page.getByRole('button', { name: /select product to add/i }).click();
  await page.getByRole('combobox', { name: /search by name/i }).fill(productName);
  await page.getByRole('option', { name: new RegExp(productName, 'i') }).click();
  await expect(page.getByRole('button', { name: /add item/i })).toBeEnabled();
  await page.getByRole('button', { name: /add item/i }).click();
  // Mobile + desktop layouts both render (one hidden via CSS); scope to the
  // visible line item rather than a bare .first() that can hit the hidden copy.
  await expect(page.getByText(productName).filter({ visible: true }).first()).toBeVisible();
}

async function saveManualSupplier(page: Page, name: string, phone: string) {
  await page.getByRole('button', { name: /select supplier/i }).click();
  const dialog = page.getByRole('dialog', { name: /select supplier/i });
  await expect(dialog).toBeVisible();
  await dialog.getByText(/enter manually/i).click();
  await dialog.getByLabel(/supplier name/i).fill(name);
  await dialog.getByLabel(/supplier phone/i).fill(phone);
  await dialog.getByRole('button', { name: /save supplier/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name).first()).toBeVisible();
}

async function finalizePurchase(page: Page) {
  await page.getByRole('button', { name: /review & save/i }).last().click();
  const dialog = page.getByRole('dialog', { name: /save purchase/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /confirm save/i }).click();
  await expect(page.getByText(/purchase saved/i).first()).toBeVisible();
}

test.describe('authenticated purchase and supplier flows', () => {
  test('cashier records a cash purchase from an existing product', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'full purchase flow runs once on desktop');

    await loginAsCashier(page);
    await initializeDemoData(page);
    await page.goto('/purchases/new');

    await addProductToPurchase(page, 'Rice 5kg');
    await expect(page.getByRole('radio', { name: /cash/i })).toHaveAttribute('aria-checked', 'true');
    await finalizePurchase(page);
    await expect(page.getByRole('button', { name: /new purchase/i })).toBeVisible();
  });

  test('cashier creates a credit purchase and records a supplier payment', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'full supplier ledger flow runs once on desktop; service tests cover the math');

    const supplierName = `E2E Supplier ${Date.now()}`;
    const supplierPhone = `0566${String(Date.now()).slice(-6)}`;

    await loginAsCashier(page);
    await initializeDemoData(page);
    await page.goto('/purchases/new');

    await addProductToPurchase(page, 'Rice 5kg');
    await page.getByRole('radio', { name: /credit/i }).click();
    await saveManualSupplier(page, supplierName, supplierPhone);

    await expect(page.getByText(/owed to supplier/i).first()).toBeVisible();
    await finalizePurchase(page);

    await page.goto('/suppliers');
    await page.getByPlaceholder(/search by supplier name or phone/i).fill(supplierName);
    await expect(page.getByRole('cell', { name: supplierName })).toBeVisible();
    await page.getByRole('row', { name: new RegExp(supplierName) }).getByRole('button', { name: /view/i }).click();

    const details = page.getByRole('dialog', { name: new RegExp(supplierName) });
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: /record payment/i }).click();

    const payment = page.getByRole('dialog', { name: /record payment/i });
    await expect(payment).toBeVisible();
    await payment.getByRole('textbox').first().fill('4.20');
    await payment.getByRole('button', { name: /^save payment$/i }).click();

    await expect(page.getByText(/payment saved/i).first()).toBeVisible();
    await expect(page.getByText(/4\.20|4.20/).first()).toBeVisible();
  });
});
