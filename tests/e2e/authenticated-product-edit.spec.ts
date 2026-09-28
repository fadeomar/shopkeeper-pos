import { expect, test } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from './helpers/auth';

test.describe('authenticated product editing', () => {
  test('prefills stored prices and keeps cashier edits instead of resetting them', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chrome',
      'product edit regression runs once on desktop',
    );
    await loginAsOwner(page);
    await initializeDemoData(page);
    await page.goto('/products');

    const milkRow = page
      .getByRole('row')
      .filter({ hasText: 'Milk 1L' })
      .first();
    await expect(milkRow).toBeVisible();
    await milkRow.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.getByText(/edit product:\s*milk 1l/i)).toBeVisible();

    const buyPrice = page.getByLabel(/^buy price$/i);
    const sellPrice = page.getByLabel(/^sell price$/i);
    await expect(buyPrice).toHaveValue('1.10');
    await expect(sellPrice).toHaveValue('1.60');

    // Regression: the shared reset effect used to fire when isDirty flipped
    // after the first edit, immediately restoring the old stored prices.
    await buyPrice.fill('1.25');
    await expect(buyPrice).toHaveValue('1.25');
    await sellPrice.fill('1.90');
    await expect(sellPrice).toHaveValue('1.90');

    await page.getByRole('button', { name: /^save product$/i }).click();
    await expect(page.getByText(/product updated/i).first()).toBeVisible();

    // A successful edit stays in edit mode and rehydrates from the actual
    // IndexedDB row. Regression: the parent used to jump to the blank Add
    // Product form, which made both price fields appear to become 0.00.
    await expect(page.getByText(/edit product:\s*milk 1l/i)).toBeVisible();
    await expect(page.getByLabel(/^buy price$/i)).toHaveValue('1.25');
    await expect(page.getByLabel(/^sell price$/i)).toHaveValue('1.90');

    // Reload to prove the values were persisted, not merely left in RHF state.
    await page.reload();
    const updatedMilkRow = page
      .getByRole('row')
      .filter({ hasText: 'Milk 1L' })
      .first();
    await updatedMilkRow.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.getByLabel(/^buy price$/i)).toHaveValue('1.25');
    await expect(page.getByLabel(/^sell price$/i)).toHaveValue('1.90');
  });
});
