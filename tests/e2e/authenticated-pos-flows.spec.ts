import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from './helpers/auth';

async function addProductToBill(page: Page, productName = 'Milk 1L') {
  await page.getByRole('button', { name: /select product/i }).first().click();
  await page.getByRole('combobox', { name: /search by name/i }).fill(productName);
  await page.getByRole('option', { name: new RegExp(productName, 'i') }).click();
  // The POS renders mobile + desktop layouts (one hidden via CSS), so scope to
  // the visible cart instance rather than a bare .first() that can land on the
  // hidden copy.
  await expect(page.getByText(productName).filter({ visible: true }).first()).toBeVisible();
}

async function finalizeBill(page: Page) {
  await page.getByRole('button', { name: /review & finalize/i }).last().click();
  const dialog = page.getByRole('dialog', { name: /finalize bill/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /confirm save/i }).click();
  await expect(page.getByText(/sale completed/i).first()).toBeVisible();
}

async function saveManualCustomer(page: Page, name: string, phone: string) {
  await page.getByRole('button', { name: /select customer/i }).click();
  const dialog = page.getByRole('dialog', { name: /select customer/i });
  await expect(dialog).toBeVisible();
  await dialog.getByText(/enter manually/i).click();
  await dialog.getByLabel(/customer name/i).fill(name);
  await dialog.getByLabel(/customer phone/i).fill(phone);
  await dialog.getByRole('button', { name: /save customer/i }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(name).first()).toBeVisible();
}

test.describe('authenticated POS billing flows', () => {
  test('cashier finalizes a cash sale and sees the saved receipt panel', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'full finalize flow runs once on desktop; mobile has its own smoke test');

    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, 'Milk 1L');
    await expect(page.getByRole('radio', { name: /cash/i })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/mixed/i)).toHaveCount(0);

    await finalizeBill(page);
    await expect(page.getByText(/saved locally|syncing/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /new sale/i })).toBeVisible();
  });

  test('cashier creates a credit bill and records a customer payment', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'full ledger flow runs once on desktop; service tests cover the business math');

    const customerName = `E2E Credit Customer ${Date.now()}`;
    const customerPhone = `0599${String(Date.now()).slice(-6)}`;

    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, 'Milk 1L');
    await page.getByRole('radio', { name: /credit/i }).click();
    await saveManualCustomer(page, customerName, customerPhone);

    await expect(page.getByText(/amount due/i).first()).toBeVisible();
    await finalizeBill(page);

    await page.goto('/customers');
    await page.getByPlaceholder(/search customer name or phone/i).fill(customerName);
    await expect(page.getByRole('cell', { name: customerName })).toBeVisible();
    await page.getByRole('row', { name: new RegExp(customerName) }).getByRole('button', { name: /view/i }).click();

    const details = page.getByRole('dialog', { name: new RegExp(customerName) });
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: /record payment/i }).click();

    const payment = page.getByRole('dialog', { name: /record payment/i });
    await expect(payment).toBeVisible();
    await payment.getByRole('textbox').first().fill('1.60');
    await payment.getByRole('button', { name: /^save payment$/i }).click();

    await expect(page.getByText(/payment saved/i).first()).toBeVisible();
    await expect(page.getByText(/1\.60|1.60/).first()).toBeVisible();
  });

  test('mobile cashier can reach billing, add an item, and open finalize review', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile-only smoke test');

    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, 'Milk 1L');
    await expect(page.getByRole('button', { name: /review & finalize/i }).last()).toBeVisible();
    await page.getByRole('button', { name: /review & finalize/i }).last().click();
    await expect(page.getByRole('dialog', { name: /finalize bill/i })).toBeVisible();
  });
});
