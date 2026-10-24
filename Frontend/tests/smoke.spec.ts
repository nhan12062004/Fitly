import { expect, test } from '@playwright/test';

test('loads the public landing page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Fitly/i);
  await expect(page.locator('header').getByRole('img', { name: 'Fitly', exact: true })).toBeVisible();
});
