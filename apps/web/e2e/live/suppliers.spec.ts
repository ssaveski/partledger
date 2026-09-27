import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

/**
 * The parts and supplier screens on the HTTP adapter (U10): the tenant's own rows through the
 * API, with the designed loading, empty and error states. The stack is
 * apps/api/test/e2e/staff-stack.ts, whose tenant starts with no parts or suppliers; the member
 * is a buyer and quality engineer there, so this test adds its data through the API's commands.
 */
const staffUserFile = join(tmpdir(), 'partledger-e2e-staff-user.json');
const staffUser = z.object({ username: z.string(), password: z.string() });

// The header every state-changing staff request carries (staffRequestHeader in the contracts).
const staffRequestHeaders = { 'x-partledger-request': 'staff-app' };

const screens = [
  {
    path: '/parts',
    title: 'Parts',
    query: 'parts.list',
    loading: 'Loading the parts…',
    empty: 'No parts yet',
    grid: 'Parts',
  },
  {
    path: '/suppliers',
    title: 'Suppliers',
    query: 'suppliers.list',
    loading: 'Loading the suppliers…',
    empty: 'No suppliers yet',
    grid: 'Suppliers',
  },
] as const;

async function signIn(page: Page): Promise<void> {
  const user = staffUser.parse(JSON.parse(readFileSync(staffUserFile, 'utf8')));
  await page.goto('/');
  await page.getByLabel('Username or email').fill(user.username);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL('http://127.0.0.1:5173/');
}

/** Sends a command as the signed-in member, through the staff app's own /api proxy. */
async function command(page: Page, name: string, input: unknown): Promise<unknown> {
  const response = await page.evaluate(
    async ([operation, body, headers]) => {
      const sent = await fetch(`/api/v1/commands/${operation}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const text = await sent.text();
      return { status: sent.status, text };
    },
    [name, input, { ...staffRequestHeaders, 'idempotency-key': randomUUID() }] as const,
  );
  expect(response.status, `${name}: ${response.text}`).toBe(200);
  return JSON.parse(response.text);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  for (const colorScheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme });
    expect((await new AxeBuilder({ page }).analyze()).violations, colorScheme).toEqual([]);
  }
}

test('the parts and supplier screens show the tenant’s own data, with loading, empty and error states', async ({
  page,
}) => {
  await signIn(page);

  for (const screen of screens) {
    await test.step(`${screen.title}: loading, then the empty state of a tenant without data`, async () => {
      // The read waits until the loading state has been seen.
      const gate = Promise.withResolvers<undefined>();
      await page.route(`**/api/v1/queries/${screen.query}?*`, async (route) => {
        await gate.promise;
        await route.continue();
      });
      await page.goto(screen.path);
      await expect(page.getByRole('status').filter({ hasText: screen.loading })).toBeVisible();
      gate.resolve(undefined);
      await expect(page.getByRole('heading', { name: screen.empty })).toBeVisible();
      await expect(page.getByRole('grid')).toHaveCount(0);
      await page.unroute(`**/api/v1/queries/${screen.query}?*`);
      await expectNoAxeViolations(page);
    });
  }

  await test.step('the member adds a supplier with an approval and a part through the API', async () => {
    const supplier = z.object({ supplierId: z.uuid() }).parse(
      await command(page, 'suppliers.create', {
        code: 'E2E-0001',
        name: 'Synthetic Precision Castings',
        country: 'CA',
        vatId: null,
        lei: null,
      }),
    );
    await command(page, 'suppliers.setApproval', {
      supplierId: supplier.supplierId,
      expectedVersion: 0,
      status: 'approved',
      scope: ['castings'],
      expiresOn: '2999-12-31',
    });
    await command(page, 'parts.create', {
      partNumber: 'PN-E2E-001',
      revision: 'A',
      description: 'Synthetic bracket, cast',
      category: 'castings',
      unit: 'each',
    });
  });

  await test.step('the parts list shows the part from the API, with its approved supplier', async () => {
    await page.goto('/parts');
    const row = page.getByRole('grid', { name: 'Parts' }).getByRole('row').filter({ hasText: 'PN-E2E-001' });
    await expect(row).toContainText('Synthetic bracket, cast');
    await expect(row).toContainText('Castings');
    await expect(row).toContainText('Maintained here');
    await expect(row).toContainText('Active');
    // One supplier's approval covers castings.
    await expect(row.getByRole('gridcell', { name: '1', exact: true })).toBeVisible();
    await expect(page.getByRole('banner')).not.toContainText('Preview with synthetic data');
    await expectNoAxeViolations(page);
  });

  await test.step('the supplier list shows the supplier from the API, with its approval and checks', async () => {
    await page.goto('/suppliers');
    await expect(page.getByText('Your approved-supplier list is maintained here by quality engineers.')).toBeVisible();
    const row = page
      .getByRole('grid', { name: 'Suppliers' })
      .getByRole('row')
      .filter({ hasText: 'Synthetic Precision Castings' });
    await expect(row).toContainText('E2E-0001 · CA');
    await expect(row).toContainText('Approved');
    await expect(row).toContainText('Castings');
    await expect(row).toContainText('Current');
    await expect(row).toContainText('No register applies');
    await expect(row).toContainText('Evidence not assessed yet');
    await expectNoAxeViolations(page);
  });

  for (const screen of screens) {
    await test.step(`${screen.title}: an error state with a retry that recovers the data`, async () => {
      await page.route(`**/api/v1/queries/${screen.query}?*`, (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'Unavailable',
            message: 'pl.error.unavailable.dependencyUnavailable',
            params: {},
          }),
        }),
      );
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('A service this action needs is unavailable.');
      await expect(page).toHaveTitle(`Something went wrong: ${screen.title} · Partledger`);
      await expectNoAxeViolations(page);
      await page.unroute(`**/api/v1/queries/${screen.query}?*`);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('grid', { name: screen.grid })).toBeVisible();
    });
  }
});
