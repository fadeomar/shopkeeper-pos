import { expect, test, type Page } from '@playwright/test';
import { initializeDemoData, loginAsCashier } from './helpers/auth';

// Demo product Milk 1L is seeded at buyPrice 1.10 / sellPrice 1.60 (lib/db/seed.ts),
// so its default line profit is 0.50 and any price below 1.10 sells at a loss.
const MILK = 'Milk 1L';

async function addProductToBill(page: Page, productName = MILK) {
  await page.getByRole('button', { name: /select product/i }).first().click();
  await page.getByRole('combobox', { name: /search by name/i }).fill(productName);
  await page.getByRole('option', { name: new RegExp(productName, 'i') }).click();
  await expect(page.getByText(productName).filter({ visible: true }).first()).toBeVisible();
}

// The POS renders both a mobile card layout and a desktop table (one hidden via
// CSS). Scope every lookup to the currently visible instance.
function visible(page: Page, role: Parameters<Page['getByRole']>[0], name: RegExp) {
  return page.getByRole(role, { name }).filter({ visible: true });
}

test.describe('authenticated POS price editing + profit', () => {
  test('cashier edits a line price, sees profit, is warned below cost, and the edit drives the total', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'price-edit flow runs once on desktop');

    await loginAsCashier(page);
    await initializeDemoData(page);
    await page.goto('/billing');

    await addProductToBill(page, MILK);

    // Profit is visible to the cashier: per-line profit and the summary's
    // "Expected profit" row both reflect 1.60 − 1.10 = 0.50.
    await expect(page.getByText(/expected profit/i).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/0\.50/).filter({ visible: true }).first()).toBeVisible();

    const sellInput = visible(page, 'textbox', /sell:\s*milk 1l/i).first();

    // Below cost: a cashier (canEditCost) may do it, but is warned.
    await sellInput.fill('0.50');
    await expect(page.getByText(/below cost/i).filter({ visible: true }).first()).toBeVisible();

    // Raise the price back above cost — the warning clears and the edited
    // price (1.40), not the catalog price (1.60), drives the bill total.
    await sellInput.fill('1.40');
    await sellInput.blur();
    await expect(page.getByText(/below cost/i)).toHaveCount(0);

    const total = page.getByText(/1\.40/).filter({ visible: true }).first();
    await expect(total).toBeVisible();

    // Finalize — the success panel shows the edited total and a profit row.
    await page.getByRole('button', { name: /review & finalize/i }).last().click();
    const dialog = page.getByRole('dialog', { name: /finalize bill/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/1\.40/).first()).toBeVisible();
    await dialog.getByRole('button', { name: /confirm save/i }).click();

    await expect(page.getByText(/sale completed/i).first()).toBeVisible();
    await expect(page.getByText(/^profit$/i).first()).toBeVisible();
  });
});
