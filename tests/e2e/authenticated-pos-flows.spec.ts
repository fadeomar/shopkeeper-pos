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

  test('cashier can keep multiple open invoices, switch them, refresh, and cancel one', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'multi-invoice workflow is covered once on desktop');

    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, 'Milk 1L');
    await page.getByLabel(/notes/i).fill('First invoice');

    await page.getByRole('button', { name: /^new invoice$/i }).click();
    await expect(page.getByRole('button', { name: /open invoice 1/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /open invoice 2/i })).toHaveAttribute('aria-pressed', 'true');

    await addProductToBill(page, 'Rice 5kg');
    await page.getByLabel(/notes/i).fill('Second invoice');

    await page.getByRole('button', { name: /open invoice 1/i }).click();
    await expect(page.getByText('Milk 1L').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByLabel(/notes/i)).toHaveValue('First invoice');

    await page.reload();
    await expect(page.getByRole('button', { name: /open invoice 1/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Milk 1L').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByLabel(/notes/i)).toHaveValue('First invoice');

    // Finalizing invoice 1 must remove only that draft and activate invoice 2.
    await finalizeBill(page);
    await expect(page.getByRole('button', { name: /open invoice 1/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /open invoice 2/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Rice 5kg').filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByLabel(/notes/i)).toHaveValue('Second invoice');

    await page.getByRole('button', { name: /cancel invoice 2/i }).click();
    const cancelDialog = page.getByRole('dialog', { name: /cancel this invoice/i });
    await expect(cancelDialog).toBeVisible();
    await cancelDialog.getByRole('button', { name: /^cancel invoice$/i }).click();

    await expect(page.getByRole('button', { name: /open invoice 2/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /open invoice 1/i })).toHaveCount(0);
    await expect(page.getByText(/no open invoices/i)).toBeVisible();

    // Cancelling the final draft leaves a true empty workspace. Starting again
    // is explicit and restarts the temporary draft numbering from one.
    await page.getByRole('button', { name: /^new invoice$/i }).first().click();
    await expect(page.getByRole('button', { name: /open invoice 1/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('mobile cashier can reach billing, add an item, and open finalize review', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'mobile-only smoke test');

    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, 'Milk 1L');
    const finalizeButton = page.getByRole('button', { name: /review & finalize/i }).last();
    const newInvoiceButton = page.getByRole('button', { name: /^new invoice$/i });
    await expect(finalizeButton).toBeVisible();
    await expect(newInvoiceButton).toBeVisible();

    const finalizeBox = await finalizeButton.boundingBox();
    const trayButtonBox = await newInvoiceButton.boundingBox();
    expect(finalizeBox).not.toBeNull();
    expect(trayButtonBox).not.toBeNull();

    // Mobile invoice navigation is a side rail, not another bottom bar. Its
    // New Invoice control must not geometrically overlap checkout.
    const overlaps = Boolean(
      finalizeBox &&
        trayButtonBox &&
        finalizeBox.x < trayButtonBox.x + trayButtonBox.width &&
        finalizeBox.x + finalizeBox.width > trayButtonBox.x &&
        finalizeBox.y < trayButtonBox.y + trayButtonBox.height &&
        finalizeBox.y + finalizeBox.height > trayButtonBox.y,
    );
    expect(overlaps).toBe(false);

    await finalizeButton.click();
    await expect(page.getByRole('dialog', { name: /finalize bill/i })).toBeVisible();
  });
});
