import { expect, test } from '@playwright/test';
import { initializeDemoData, loginAsCashier } from './helpers/auth';

async function openShift(page: import('@playwright/test').Page, openingCash = '10.00') {
  await page.goto('/shift');
  await expect(page.getByRole('heading', { name: /cash drawer shift/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /no shift open/i })).toBeVisible();

  await page.getByLabel(/opening cash/i).fill(openingCash);
  await page.getByLabel(/cashier/i).fill('E2E Cashier');
  await page.getByRole('button', { name: /open new shift/i }).click();

  await expect(page.getByText(/shift opened/i).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /active shift/i })).toBeVisible();
}

async function recordCashIn(page: import('@playwright/test').Page, amount = '3.00') {
  await page.goto('/cash');
  await expect(page.getByRole('heading', { name: /cash drawer/i })).toBeVisible();

  await page.getByRole('button', { name: /record movement/i }).click();
  const dialog = page.getByRole('dialog', { name: /confirm cash movement/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/active shift/i)).toBeVisible();

  await dialog.getByLabel(/amount/i).fill(amount);
  await dialog.getByLabel(/reference/i).fill('E2E float top-up');
  await dialog.getByRole('button', { name: /^record$/i }).click();

  await expect(page.getByText(/cash movement recorded/i).first()).toBeVisible();
  await expect(dialog).toBeHidden();
}

test.describe('authenticated shift and cash drawer flows', () => {
  test('cashier opens a shift, records manual cash in, then closes with a report', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'cash drawer reconciliation is covered once on desktop');

    await loginAsCashier(page);
    await initializeDemoData(page);

    await openShift(page, '10.00');
    await recordCashIn(page, '3.00');

    await page.goto('/shift');
    await expect(page.getByRole('heading', { name: /active shift/i })).toBeVisible();
    await expect(page.getByText(/manual cash net/i)).toBeVisible();
    await expect(page.getByText(/13\.00/).first()).toBeVisible();

    await page.getByRole('button', { name: /^close shift$/i }).first().click();
    const closeDialog = page.getByRole('dialog', { name: /close shift/i });
    await expect(closeDialog).toBeVisible();
    await expect(closeDialog.getByText(/expected cash/i)).toBeVisible();
    await closeDialog.getByLabel(/counted cash/i).fill('13.00');
    await closeDialog.getByLabel(/closing notes/i).fill('E2E matched drawer');
    await closeDialog.getByRole('button', { name: /^close shift$/i }).click();

    await expect(page.getByText(/shift closed/i).first()).toBeVisible();
    await expect(page.getByRole('dialog', { name: /view report/i })).toBeVisible();
    await page.getByRole('dialog', { name: /view report/i }).getByRole('button', { name: /close/i }).first().click();
    await expect(page.getByRole('heading', { name: /no shift open/i })).toBeVisible();
    await expect(page.getByRole('cell', { name: /E2E Cashier/i })).toBeVisible();
  });
});
