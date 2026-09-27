import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Surfaces of the dark and light themes in libs/ui/src/tokens/themes.ts.
for (const [colorScheme, theme, surface] of [
  ['dark', 'dark', 'rgb(14, 17, 19)'],
  ['light', 'light', 'rgb(246, 248, 249)'],
] as const) {
  test(`the web shell renders its translated navigation and page title with no axe violations in the ${theme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Overview' })).toBeVisible();
    await expect(page).toHaveTitle('Overview · Partledger');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('body')).toHaveCSS('background-color', surface);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Inter Variable/);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

test('the shell tells the person that the screens show synthetic data while the fixture adapter serves them', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('banner')).toContainText('Preview with synthetic data. Nothing you do here is saved.');
});

test('a missing translation key shows the designed error state instead of a blank page', async ({ page }) => {
  await page.route(/\/i18n\/en\/web\.json/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace('pl.web.navigation.overview', 'pl.web.removedByTheTest');
    await route.fulfill({ response, body });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
