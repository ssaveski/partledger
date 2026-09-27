import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const colorScheme of ['dark', 'light'] as const) {
  test(`the shell's alerts open from the banner by keyboard and list the synthetic alerts with no axe violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    const trigger = page.getByRole('banner').getByRole('button', { name: 'Alerts, 2 in the last 30 days' });
    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Alerts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { level: 3, name: 'The audit trail check failed' })).toBeVisible();
    await expect(dialog).toContainText('The nightly check failed at entry 1187.');
    await expect(dialog.getByRole('heading', { level: 3, name: 'Supplier evidence expires soon' })).toBeVisible();
    await expect(dialog).toContainText('A supplier document expires in 21 days.');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test("following an alert's link navigates inside the app and closes the alerts dialog", async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'Alerts, 2 in the last 30 days' }).click();
  const dialog = page.getByRole('dialog', { name: 'Alerts' });
  await dialog.getByRole('link', { name: 'View Supplier evidence expires soon' }).click();
  await expect(page).toHaveURL(/\/evidence$/);
  await expect(dialog).toBeHidden();
});
