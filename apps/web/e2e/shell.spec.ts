import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('the web shell renders its translated title with no axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Partledger' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
