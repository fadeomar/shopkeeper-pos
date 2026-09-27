import { expect, test } from '@playwright/test';
import { initializeDemoData, loginAsOwner } from './helpers/auth';

test.describe('authenticated product editing', () => {
  test('prefills the stored buy and sell prices when opening an existing product for edit', async ({
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
    await expect(page.getByLabel(/^buy price$/i)).toHaveValue('1.10');
    await expect(page.getByLabel(/^sell price$/i)).toHaveValue('1.60');
  });
});
