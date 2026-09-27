import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * Member and role administration in the preview (U8): the synthetic tenant's members, invited,
 * given roles and removed through the same commands the API serves, with nothing saved.
 */

async function expectNoAxeViolations(page: Page): Promise<void> {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

function membersTable(page: Page) {
  return page.getByRole('table', { name: 'Members of Maple Ridge Components' });
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`the members screen lists the tenant's members and their roles with no axe violations in the ${colorScheme} theme`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Members' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(page).toHaveTitle('Members · Partledger');
    const row = membersTable(page).getByRole('row').filter({ hasText: 'Sasha Okonkwo-Ruiz' });
    await expect(row).toContainText('Approver');
    await expect(row).toContainText('Auditor');
    await expect(membersTable(page).getByRole('row').filter({ hasText: 'Jun Halvorsen' })).toContainText('No role yet');
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Invite member' }).click();
    await expect(page.getByRole('dialog', { name: 'Invite a member' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test('the banner names the tenant, its region and the signed-in member', async ({ page }) => {
  await page.goto('/');
  const banner = page.getByRole('banner');
  await expect(banner).toContainText('Maple Ridge Components · data stored in Canada');
  await expect(banner).toContainText('Signed in as Avery Lindqvist');
});

test('an administrator invites a member by keyboard, is told what is missing, and sees them listed', async ({
  page,
}) => {
  await page.goto('/admin/members');
  await page.getByRole('button', { name: 'Invite member' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Invite a member' });
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog.getByText('Enter an email address, such as name@example.com.')).toBeVisible();
  await expect(dialog.getByText("Enter the person's name.")).toBeVisible();
  await expect(dialog.getByLabel('Work email')).toBeFocused();

  await page.keyboard.type('Kai.Berglund@Synthetic.Test');
  await page.keyboard.press('Tab');
  await page.keyboard.type('Kai Berglund');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Kai Berglund was invited.');
  const row = membersTable(page).getByRole('row').filter({ hasText: 'Kai Berglund' });
  await expect(row).toContainText('kai.berglund@synthetic.test');
  await expect(row).toContainText('No role yet');
  await expect(page.getByRole('button', { name: 'Invite member' })).toBeFocused();
});

test('an administrator changes a member’s roles and removes a member', async ({ page }) => {
  await page.goto('/admin/members');
  await page.getByRole('button', { name: 'Change roles for Jun Halvorsen' }).click();
  const roles = page.getByRole('dialog', { name: 'Roles for Jun Halvorsen' });
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(roles.getByText('Choose at least one change before saving.')).toBeVisible();
  await roles.getByRole('checkbox', { name: 'Buyer' }).check();
  await roles.getByRole('checkbox', { name: 'Quality engineer' }).check();
  await roles.getByRole('button', { name: 'Save roles' }).click();
  await expect(roles).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Roles for Jun Halvorsen were saved.');
  const row = membersTable(page).getByRole('row').filter({ hasText: 'Jun Halvorsen' });
  await expect(row).toContainText('Buyer');
  await expect(row).toContainText('Quality engineer');

  await page.getByRole('button', { name: 'Remove Rowan Achterberg' }).click();
  const removal = page.getByRole('dialog', { name: 'Remove Rowan Achterberg?' });
  await expectNoAxeViolations(page);
  await removal.getByRole('button', { name: 'Remove member' }).click();
  await expect(removal).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('Rowan Achterberg was removed.');
  await expect(membersTable(page).getByRole('row').filter({ hasText: 'Rowan Achterberg' })).toHaveCount(0);
});

test('removing the last administrator is refused and says why', async ({ page }) => {
  await page.goto('/admin/members');
  await page.getByRole('button', { name: 'Remove Avery Lindqvist' }).click();
  const removal = page.getByRole('dialog', { name: 'Remove Avery Lindqvist?' });
  await removal.getByRole('button', { name: 'Remove member' }).click();
  await expect(removal.getByRole('alert')).toHaveText(
    'The tenant needs at least one administrator. Make someone else an administrator first.',
  );
});

test('signing out of the preview shows the signed-out page with focus on its heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  const heading = page.getByRole('heading', { level: 1, name: 'You have signed out' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expectNoAxeViolations(page);
});

/** Opens the roles dialog of a member, sets roles on and off, and saves. */
async function changeRoles(page: Page, name: string, change: { on?: string[]; off?: string[] }) {
  await page.getByRole('button', { name: `Change roles for ${name}` }).click();
  const dialog = page.getByRole('dialog', { name: `Roles for ${name}` });
  for (const role of change.on ?? []) {
    await dialog.getByRole('checkbox', { name: role }).check();
  }
  for (const role of change.off ?? []) {
    await dialog.getByRole('checkbox', { name: role }).uncheck();
  }
  await dialog.getByRole('button', { name: 'Save roles' }).click();
  return dialog;
}

test('after a partial refusal the table shows the role that was granted', async ({ page }) => {
  await page.goto('/admin/members');
  // Approver is granted first; taking away the only administrator's role is then refused.
  const dialog = await changeRoles(page, 'Avery Lindqvist', { on: ['Approver'], off: ['Tenant admin'] });
  await expect(dialog.getByRole('alert')).toHaveText(
    'The tenant needs at least one administrator. Make someone else an administrator first.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(membersTable(page).getByRole('row').filter({ hasText: 'Avery Lindqvist' })).toContainText('Approver');
});

test('removing your own tenant-admin role hides the Members link', async ({ page }) => {
  await page.goto('/admin/members');
  await expect(await changeRoles(page, 'Rowan Achterberg', { on: ['Tenant admin'] })).toBeHidden();
  await expect(await changeRoles(page, 'Avery Lindqvist', { off: ['Tenant admin'] })).toBeHidden();
  const navigation = page.getByRole('navigation', { name: 'Main' });
  await expect(navigation.getByRole('link', { name: 'Overview' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: 'Members' })).toHaveCount(0);
});

test('removing yourself lands on the signed-out page', async ({ page }) => {
  await page.goto('/admin/members');
  await expect(await changeRoles(page, 'Rowan Achterberg', { on: ['Tenant admin'] })).toBeHidden();
  await page.getByRole('button', { name: 'Remove Avery Lindqvist' }).click();
  await page
    .getByRole('dialog', { name: 'Remove Avery Lindqvist?' })
    .getByRole('button', { name: 'Remove member' })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'You have signed out' })).toBeVisible();
});

test('cancelling Remove returns focus to the Remove button that opened it', async ({ page }) => {
  await page.goto('/admin/members');
  const remove = page.getByRole('button', { name: 'Remove Jun Halvorsen' });
  await remove.click();
  await page
    .getByRole('dialog', { name: 'Remove Jun Halvorsen?' })
    .getByRole('button', { name: 'Keep member' })
    .click();
  await expect(remove).toBeFocused();
});
