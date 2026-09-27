import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

/**
 * Staff sign-in end to end (KTD20): the browser signs in through the containerised Keycloak
 * and signs out against the API's session endpoints, all through the staff app's `/api`
 * proxy. The stack (PostgreSQL, Keycloak, the built API) is started by Playwright from
 * `apps/api/test/e2e/staff-stack.ts`, which writes the synthetic user's generated credentials
 * to the file below (kept in step with `staff-stack-contract.ts`).
 */
const staffUserFile = join(tmpdir(), 'partledger-e2e-staff-user.json');
const staffUser = z.object({ username: z.string(), password: z.string(), tenantId: z.uuid() });

function syntheticUser() {
  return staffUser.parse(JSON.parse(readFileSync(staffUserFile, 'utf8')));
}

function fetchStatus(page: Page, path: string, init: RequestInit = {}): Promise<number> {
  return page.evaluate(async ([target, options]) => (await fetch(target, options)).status, [path, init] as const);
}

test('a synthetic buyer signs in through Keycloak and out through the API, after which the session is refused', async ({
  page,
  context,
}) => {
  const user = syntheticUser();
  await page.goto('/api/v1/auth/sign-in?returnTo=%2F');

  // With organizations enabled, Keycloak identifies the user first and asks for the password next.
  await page.getByLabel('Username or email').fill(user.username);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await page.waitForURL('http://127.0.0.1:5173/');
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
  const [sessionCookie] = (await context.cookies()).filter((cookie) => cookie.name === '__Host-pl_session');
  expect(sessionCookie).toMatchObject({ path: '/', httpOnly: true, secure: true, sameSite: 'Strict' });
  expect(await page.evaluate(() => document.cookie)).not.toContain('pl_session');

  const session = await page.evaluate(async () => {
    const response = await fetch('/api/v1/auth/session');
    return { status: response.status, body: await response.text() };
  });
  expect(session.status).toBe(200);
  expect(JSON.parse(session.body)).toMatchObject({ tenantId: user.tenantId });

  expect(await fetchStatus(page, '/api/v1/auth/sign-out', { method: 'POST' })).toBe(403);
  expect(
    await fetchStatus(page, '/api/v1/auth/sign-out', {
      method: 'POST',
      headers: { 'x-partledger-request': 'staff-app' },
    }),
  ).toBe(204);
  expect(await fetchStatus(page, '/api/v1/auth/session')).toBe(401);
  expect((await context.cookies()).some((cookie) => cookie.name === '__Host-pl_session')).toBe(false);

  // The server ended the session: replaying the old cookie is refused too.
  if (sessionCookie === undefined) {
    throw new Error('No session cookie was set');
  }
  await context.addCookies([sessionCookie]);
  expect(await fetchStatus(page, '/api/v1/auth/session')).toBe(401);
});
