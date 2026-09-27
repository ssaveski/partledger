import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

/**
 * The staff app on its HTTP adapter (U8): a member signs in through Keycloak, sees their own
 * tenant and roles, read from the tenant's rows through the API, and loses access when they sign
 * out. The stack is apps/api/test/e2e/staff-stack.ts; the member's credentials come from the
 * file it writes (kept in step with staff-stack-contract.ts).
 */
const staffUserFile = join(tmpdir(), 'partledger-e2e-staff-user.json');
const staffUser = z.object({
  username: z.string(),
  password: z.string(),
  tenantId: z.uuid(),
  tenantDisplayName: z.string(),
  displayName: z.string(),
});

function syntheticUser() {
  return staffUser.parse(JSON.parse(readFileSync(staffUserFile, 'utf8')));
}

async function signIn(page: Page, user: z.infer<typeof staffUser>): Promise<void> {
  await page.goto('/');
  // The app finds no session and sends the person to Keycloak, which asks for the username first.
  await page.getByLabel('Username or email').fill(user.username);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('http://127.0.0.1:5173/');
}

test('a member signs in, sees the dashboard of their own tenant, signs out and loses access', async ({ page }) => {
  const user = syntheticUser();
  await signIn(page, user);

  const banner = page.getByRole('banner');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  await expect(banner).toContainText(`${user.tenantDisplayName} · data stored in Canada`);
  await expect(banner).toContainText(`Signed in as ${user.displayName}`);
  // Live data, so no preview notice.
  await expect(banner).not.toContainText('Preview with synthetic data');

  // The member administers the tenant, so the members screen reads the tenant's own rows.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Members' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  const table = page.getByRole('table', { name: `Members of ${user.tenantDisplayName}` });
  await expect(table.getByRole('rowheader', { name: new RegExp(user.displayName) })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await banner.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'You have signed out' })).toBeVisible();
  expect(await page.evaluate(async () => (await fetch('/api/v1/auth/session')).status)).toBe(401);
  expect(
    await page.evaluate(async () => (await fetch('/api/v1/queries/tenants.currentMember?input=%7B%7D')).status),
  ).toBe(401);

  // Opening the app again leads to the identity provider's sign-in, not to the tenant.
  await page.goto('/admin/members');
  await expect(page.getByLabel('Username or email')).toBeVisible();
  expect(page.url()).not.toContain('127.0.0.1:5173');
});
