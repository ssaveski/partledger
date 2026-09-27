import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// The fixture RFQs of libs/contracts/src/fixtures/rfqs.ts, one per scenario.
function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

const rfq = {
  open: fixtureId(1042),
  closed: fixtureId(1038),
  draftWithoutSuppliers: fixtureId(1050),
};

const detail = (id: string) => `/rfqs/${id}`;
const assignment = (id: string) => `/rfqs/${id}/assignment`;

/** Presses Tab until the target has focus, as a keyboard-only person would. */
async function tabTo(page: Page, target: Locator, limit = 120): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('The target never received focus by Tab');
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

async function loaded(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
}

function documentCard(page: Page, heading: string): Locator {
  return page.getByRole('article', { name: heading });
}

function lineGroup(page: Page, line: number): Locator {
  return page.getByRole('group', { name: new RegExp(`^Line ${line}\\b`) });
}

// ---------------------------------------------------------------------------------------------
// Designed states

const listScreens = [
  { name: 'RFQ list', path: '/rfqs', title: 'RFQs', loading: 'Loading the RFQs…', empty: 'No RFQs yet' },
  {
    name: 'RFQ builder',
    path: '/rfqs/new',
    title: 'New RFQ',
    loading: 'Loading the parts list…',
    empty: 'No active parts',
  },
  { name: 'parts list', path: '/parts', title: 'Parts', loading: 'Loading the parts…', empty: 'No parts yet' },
  {
    name: 'supplier list',
    path: '/suppliers',
    title: 'Suppliers',
    loading: 'Loading the suppliers…',
    empty: 'No suppliers yet',
  },
  {
    name: 'evidence review',
    path: '/evidence',
    title: 'Evidence review',
    loading: 'Loading the evidence queue…',
    empty: 'No documents await confirmation',
  },
  {
    name: 'supplier assignment',
    path: assignment(rfq.draftWithoutSuppliers),
    title: 'Supplier assignment',
    loading: 'Loading the suppliers for each line…',
    empty: 'No suppliers to invite',
  },
] as const;

test.describe('designed states', () => {
  for (const screen of listScreens) {
    test(`the ${screen.name} shows its loading state while the read is in flight`, async ({ page }) => {
      await page.goto(`${screen.path}?preview=slow`);
      await expect(page.getByRole('status').filter({ hasText: screen.loading })).toBeVisible();
      await expect(page).toHaveTitle(`${screen.title} · Partledger`);
      await expectNoAxeViolations(page);
    });

    test(`the ${screen.name} shows its empty state, never an empty grid`, async ({ page }) => {
      await page.goto(`${screen.path}?preview=empty`);
      await expect(page.getByRole('heading', { name: screen.empty })).toBeVisible();
      await expect(page.getByRole('grid')).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

    test(`the ${screen.name} shows an error state with a retry when the read fails`, async ({ page }) => {
      await page.goto(`${screen.path}?preview=unavailable`);
      await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('A service this action needs is unavailable.');
      await expect(page).toHaveTitle(`Something went wrong: ${screen.title} · Partledger`);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
    });

    test(`the ${screen.name} shows the no-permission state when the server refuses the reader`, async ({ page }) => {
      await page.goto(`${screen.path}?preview=forbidden`);
      await expect(page.getByRole('heading', { level: 1, name: 'You do not have access to this' })).toBeVisible();
      await expect(page).toHaveTitle(`No access: ${screen.title} · Partledger`);
    });
  }

  test('the overview loads each of its sections on its own', async ({ page }) => {
    await page.goto('/?preview=slow');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    for (const loading of ['Loading the RFQs…', 'Loading the evidence queue…', 'Loading the suppliers…']) {
      await expect(page.getByRole('status').filter({ hasText: loading })).toBeVisible();
    }
    await expectNoAxeViolations(page);
  });

  test('the overview shows an empty state with a next action in each section', async ({ page }) => {
    await page.goto('/?preview=empty');
    await expect(page.getByRole('heading', { level: 3, name: 'No RFQs yet' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Nothing to review' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'No suppliers yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New RFQ', exact: true })).toBeVisible();
  });

  test('the overview shows an error with a retry in each section when its read fails', async ({ page }) => {
    await page.goto('/?preview=unavailable');
    await expect(page.getByRole('alert')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(3);
  });

  test('the overview shows the no-permission state in each section the server refuses', async ({ page }) => {
    await page.goto('/?preview=forbidden');
    await expect(page.getByRole('heading', { level: 3, name: 'You do not have access to this' })).toHaveCount(3);
  });

  test('a filter that matches nothing shows an empty state that clears it, never an empty grid', async ({ page }) => {
    await page.goto('/parts?q=zzz');
    await expect(page.getByRole('heading', { name: 'No parts match these filters' })).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('grid', { name: 'Parts' }).getByRole('row')).toHaveCount(13);
    await expect(page.getByRole('searchbox', { name: 'Search by part number or description' })).toBeFocused();
    await expect(page.getByRole('searchbox', { name: 'Search by part number or description' })).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------------------------
// Overview, lists

test.describe('overview and lists', () => {
  test('the overview leads with open RFQs, evidence to review and suppliers needing attention', async ({ page }) => {
    await page.goto('/');
    await loaded(page);
    const rfqs = page.getByRole('region', { name: 'RFQs', exact: true });
    await expect(rfqs.getByRole('link', { name: 'RFQ-1042' })).toBeVisible();
    await expect(rfqs).toContainText('Lines changed: 1');
    const suppliers = page.getByRole('region', { name: 'Suppliers needing attention' });
    await expect(suppliers).toContainText('Birchfield Precision');
    await expect(suppliers).toContainText('Expires within 60 days');
    const evidence = page.getByRole('region', { name: 'Evidence', exact: true });
    const tile = (label: string) => evidence.getByRole('term').filter({ hasText: label }).locator('xpath=..');
    await expect(tile('Awaiting confirmation, expiring within 60 days').getByRole('definition')).toHaveText('1');
    await expect(evidence.getByRole('definition').first()).toHaveText('5');
  });

  test('the RFQ list sorts and filters by status, and flags drifted lines', async ({ page }) => {
    await page.goto('/rfqs');
    const grid = page.getByRole('grid', { name: 'RFQs' });
    await expect(grid.getByRole('row')).toHaveCount(6);
    const open = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'RFQ-1042' }) });
    await expect(open.getByRole('gridcell', { name: /Part changed since publish/ })).toContainText('Lines changed: 1');

    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Awaiting approval' }).click();
    await expect(page).toHaveURL(/status=pendingApproval/);
    await expect(grid.getByRole('row')).toHaveCount(3);

    const deadline = grid.getByRole('columnheader', { name: 'Deadline' });
    await deadline.getByRole('button').click();
    await expect(deadline).toHaveAttribute('aria-sort', 'ascending');
    await expect(grid.getByRole('rowheader').first()).toHaveText('RFQ-1027');
  });

  test('the parts list sorts and filters by category and text', async ({ page }) => {
    await page.goto('/parts');
    const grid = page.getByRole('grid', { name: 'Parts' });
    await expect(grid.getByRole('row')).toHaveCount(13);
    await page.getByRole('combobox', { name: 'Category' }).click();
    await page.getByRole('option', { name: 'Castings' }).click();
    await expect(grid.getByRole('row')).toHaveCount(3);
    await expect(page.getByRole('status').filter({ hasText: 'Showing 2 of 12 parts.' })).toBeVisible();

    await page.goto('/parts?q=o-ring');
    await expect(grid.getByRole('rowheader')).toHaveText(['PN-31007']);
    await expect(grid.getByRole('row').nth(1)).toContainText('Deactivated');

    await page.goto('/parts');
    const part = grid.getByRole('columnheader', { name: 'Part' });
    await part.getByRole('button').click();
    await part.getByRole('button').click();
    await expect(part).toHaveAttribute('aria-sort', 'descending');
    await expect(grid.getByRole('rowheader').first()).toHaveText('PN-50011');
  });

  test('the supplier list shows approval scope, expiry and identity-check badges', async ({ page }) => {
    await page.goto('/suppliers');
    const grid = page.getByRole('grid', { name: 'Suppliers' });
    const row = (name: string) => grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) });
    await expect(row('Birchfield Precision')).toContainText('Machined parts, Fasteners, Seals');
    await expect(row('Birchfield Precision').getByRole('gridcell', { name: /Expires within 60 days/ })).toBeVisible();
    await expect(row('Halden Electronics')).toContainText('Approval suspended');
    await expect(row('Halden Electronics').locator('[data-state-badge="approvalExpired"]')).toHaveText('Expired');
    await expect(row('Kestrel Machining').locator('[data-state-badge="identityMismatch"]')).toHaveText(
      'Register names someone else',
    );
    await expect(row('Lindqvist Sheet Metal').locator('[data-state-badge="identityVerified"]')).toHaveText(
      'Identity verified',
    );
    await expect(row('Arbor Fasteners').locator('[data-state-badge="identityNotChecked"]')).toHaveText('Not checked');
    await expect(page.getByText('Your approved-supplier list mirrors your ERP')).toBeVisible();

    await expect(row('Northwind Castings').locator('[data-state-badge="approvalCurrent"]')).toHaveText('Current');
    await expect(row('Northwind Castings')).toContainText('NOR-0101 · CA');
    await expect(page.locator('[data-legend-entry="approvalExpiringSoon"]')).toHaveText('Expires within 60 days');
    await expect(page.locator('[data-legend-entry="identityMismatch"]')).toHaveText('Register names someone else');

    await page.getByRole('searchbox', { name: 'Search by name or code' }).fill('nor-0101');
    await expect(grid.getByRole('rowheader')).toHaveText(['Northwind Castings']);
  });

  test('the supplier grid fits a 1280-pixel window without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/suppliers');
    const container = page.getByRole('grid', { name: 'Suppliers' }).locator('xpath=..');
    const overflow = await container.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------------------------
// RFQ builder, assignment, detail

test.describe('RFQ builder and supplier assignment', () => {
  test('supplier assignment shows which suppliers are outside a line approved scope', async ({ page }) => {
    await page.goto(assignment(rfq.draftWithoutSuppliers));
    await loaded(page);
    await expect(page.locator('[data-legend-entry="outOfScope"]')).toHaveText('Outside approved scope');
    const castings = lineGroup(page, 1);
    await expect(castings).toContainText('Castings');
    await expect(castings.getByRole('checkbox', { name: 'Northwind Castings' })).toHaveAccessibleDescription(
      /^Within approved scope/,
    );
    for (const supplier of ['Kestrel Machining', 'Birchfield Precision', 'Halden Electronics']) {
      await expect(castings.getByRole('checkbox', { name: supplier })).toHaveAccessibleDescription(
        /^Outside approved scope/,
      );
    }
    await expect(lineGroup(page, 2).getByRole('checkbox', { name: 'Kestrel Machining' })).toHaveAccessibleDescription(
      /^Within approved scope/,
    );
  });

  test('an open RFQ shows the out-of-scope suppliers it invited, and cannot be reassigned', async ({ page }) => {
    await page.goto(assignment(rfq.open));
    const castings = lineGroup(page, 1);
    const kestrel = castings.getByRole('checkbox', { name: 'Kestrel Machining' });
    await expect(kestrel).toBeChecked();
    await expect(kestrel).toHaveAccessibleDescription(/^Outside approved scope/);
    await expect(castings).toContainText('Outside approved scope: 2.');
    await expect(kestrel).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Publish RFQ' })).toHaveAccessibleDescription(
      'This RFQ is already published.',
    );
  });

  test('publishing needs a supplier on every line', async ({ page }) => {
    await page.goto(assignment(rfq.draftWithoutSuppliers));
    await page.getByRole('button', { name: 'Publish RFQ' }).click();
    await expect(lineGroup(page, 1).getByText('Invite at least one supplier to this line.')).toBeVisible();
    await expect(lineGroup(page, 2).getByText('Invite at least one supplier to this line.')).toBeVisible();
    await expect(page).toHaveURL(/\/assignment$/);
  });

  test('the RFQ builder publishes an RFQ from fixture parts', async ({ page }) => {
    await page.goto('/rfqs/new');
    await loaded(page);
    await page.getByRole('textbox', { name: 'Title' }).fill('Housings and fasteners for the winter build');
    await page.getByLabel('Response deadline (UTC)').fill('2030-10-30T16:00');
    const parts = page.getByRole('grid', { name: 'Active parts' });
    await expect(parts.getByRole('rowheader', { name: 'PN-31007' })).toHaveCount(0);
    await parts.getByRole('button', { name: 'Add PN-10432' }).click();
    await parts.getByRole('button', { name: 'Add PN-31005' }).click();
    await expect(parts.getByRole('button', { name: 'Remove PN-10432' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lines (2)' })).toBeVisible();

    await page.getByRole('button', { name: 'Save draft and invite suppliers' }).click();
    await expect(lineGroup(page, 1).getByText('Enter a whole quantity above zero.')).toBeVisible();

    await lineGroup(page, 1).getByRole('textbox', { name: 'Quantity (each)' }).fill('200');
    await lineGroup(page, 1).getByRole('textbox', { name: 'Quantity breaks' }).fill('100, 500');
    await lineGroup(page, 1).getByLabel('Required by').fill('2030-12-04');
    await lineGroup(page, 2).getByRole('textbox', { name: 'Quantity (each)' }).fill('1000');
    await lineGroup(page, 2).getByLabel('Required by').fill('2030-11-20');
    await page.getByRole('button', { name: 'Save draft and invite suppliers' }).click();

    await expect(page.getByRole('heading', { level: 1, name: /Supplier assignment/ })).toBeVisible();
    await expect(page.getByText('RFQ-1051')).toBeVisible();
    await lineGroup(page, 1).getByRole('checkbox', { name: 'Northwind Castings' }).click();
    await lineGroup(page, 2).getByText('Arbor Fasteners').click();
    await expect(lineGroup(page, 2).getByRole('checkbox', { name: 'Arbor Fasteners' })).toBeChecked();
    await page.getByRole('button', { name: 'Publish RFQ' }).click();

    await expect(page.getByRole('heading', { level: 1, name: /RFQ detail/ })).toBeVisible();
    await expect(page).toHaveTitle('RFQ-1051 detail · Partledger');
    await expect(page.getByText('Open', { exact: true })).toBeVisible();
    const responses = page.getByRole('grid', { name: 'Supplier responses to RFQ-1051' });
    await expect(responses.getByRole('rowheader')).toHaveText(['Arbor Fasteners', 'Northwind Castings']);
    const lines = page.getByRole('grid', { name: 'Lines of RFQ-1051' });
    await expect(lines.getByRole('row').nth(1)).toContainText('100, 500');

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'RFQs' }).click();
    const list = page.getByRole('grid', { name: 'RFQs' });
    await expect(list.getByRole('rowheader').first()).toHaveText('RFQ-1051');
    await expect(list.getByRole('row').nth(1)).toContainText('0 of 2 responded');
  });

  test('a draft without suppliers leads to supplier assignment', async ({ page }) => {
    await page.goto(detail(rfq.draftWithoutSuppliers));
    await page.getByRole('link', { name: 'Assign suppliers' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Supplier assignment/ })).toBeVisible();
  });
});

test.describe('RFQ detail changes', () => {
  test("the RFQ detail's extend action is unavailable once answers have been shown", async ({ page }) => {
    await page.goto(detail(rfq.closed));
    const extend = page.getByRole('button', { name: 'Extend the deadline' });
    await expect(extend).toBeDisabled();
    await expect(extend).toHaveAccessibleDescription(
      'Staff have seen the answers, so the deadline cannot be extended. Start a re-bid instead.',
    );
    await extend.click({ force: true });
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('extending an open RFQ needs a later deadline and a reason, and applies to every supplier', async ({ page }) => {
    await page.goto(detail(rfq.open));
    await page.getByRole('button', { name: 'Extend the deadline' }).click();
    const dialog = page.getByRole('dialog', { name: 'Extend the deadline' });
    await dialog.getByRole('button', { name: 'Extend' }).click();
    await expect(dialog.getByText('Choose a deadline later than the current one and than now.')).toBeVisible();
    await expect(dialog.getByText('Say why the deadline moves.')).toBeVisible();

    await dialog.getByLabel('New deadline (UTC)').fill('2030-10-16T16:00');
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Two suppliers asked for a week more.');
    await dialog.getByRole('button', { name: 'Extend' }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Deadline extended to Oct 16, 2030, 16:00 UTC' }),
    ).toBeFocused();
    await expect(page.getByRole('definition').filter({ hasText: 'Oct 16, 2030' })).toBeVisible();
  });

  test('amending a line creates the next version and says answers to it become stale', async ({ page }) => {
    await page.goto(detail(rfq.closed));
    await expect(page.getByRole('button', { name: 'Amend a line' })).toHaveCount(0);
    await page.goto(detail(rfq.open));
    await page.getByRole('button', { name: 'Amend a line' }).click();
    const dialog = page.getByRole('dialog', { name: 'Amend a line' });
    await expect(dialog).toContainText('Answers to this line become stale until each supplier responds again.');
    await dialog.getByRole('combobox', { name: 'Line' }).click();
    await page.getByRole('option', { name: 'Line 1: PN-10432 rev C' }).click();
    await dialog.getByRole('button', { name: 'Amend', exact: true }).click();
    await expect(dialog.getByText('Change the quantity or the required date to amend the line.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Quantity' }).fill('250');
    await dialog.getByRole('button', { name: 'Amend', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Line 1 amended; this is now version 3.' })).toBeVisible();
    const lines = page.getByRole('grid', { name: 'Lines of RFQ-1042' });
    await expect(lines.getByRole('row').nth(1)).toContainText('250');
  });

  test('amending opens on the drifted line and re-issues it at the current part', async ({ page }) => {
    await page.goto(detail(rfq.open));
    await expect(page.getByText('amend the line and re-issue it at the current part')).toBeVisible();
    await page.getByRole('button', { name: 'Amend a line' }).click();
    const dialog = page.getByRole('dialog', { name: 'Amend a line' });
    await expect(dialog.getByRole('combobox', { name: 'Line' })).toHaveText(/Line 3: PN-20877 rev B/);
    const reissue = dialog.getByRole('checkbox', { name: 'Re-issue at the current part (Revision B is now C)' });
    await expect(reissue).toBeChecked();
    await reissue.click();
    await dialog.getByRole('button', { name: 'Amend', exact: true }).click();
    await expect(dialog.getByText('Change the quantity or the required date to amend the line.')).toBeVisible();
    await reissue.click();
    await dialog.getByRole('button', { name: 'Amend', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Line 3 amended; this is now version 3.' })).toBeVisible();
    const shaft = page
      .getByRole('grid', { name: 'Lines of RFQ-1042' })
      .getByRole('row')
      .filter({ hasText: 'PN-20877' });
    await expect(shaft).toContainText('No change');
    await expect(shaft.getByRole('gridcell', { name: 'C', exact: true })).toBeVisible();
  });

  test('a drifted line says what changed and keeps its published snapshot', async ({ page }) => {
    await page.goto(detail(rfq.open));
    const lines = page.getByRole('grid', { name: 'Lines of RFQ-1042' });
    const shaft = lines.getByRole('row').filter({ hasText: 'PN-20877' });
    await expect(shaft.getByRole('gridcell', { name: /Part changed since publish/ })).toContainText(
      'Revision B is now C',
    );
    await expect(shaft.getByRole('gridcell', { name: 'B', exact: true })).toBeVisible();
    await expect(lines.getByRole('row').filter({ hasText: 'PN-10432' })).toContainText('No change');
  });
});

// ---------------------------------------------------------------------------------------------
// Evidence review

test.describe('evidence review', () => {
  test('the evidence review screen offers a view/download action for each document', async ({ page }) => {
    await page.goto('/evidence');
    const documents = page.getByRole('list', { name: 'Documents awaiting confirmation' }).getByRole('article');
    await expect(documents).toHaveCount(5);
    for (const document of await documents.all()) {
      await expect(document.getByRole('button', { name: /^Open document/ })).toHaveCount(1);
    }
    const halden = documentCard(page, 'Material certificate from Halden Electronics');
    await expect(halden).toContainText('halden-material-certificate-2025.pdf');
    await expect(halden).toContainText('Jonas Brandt through a supplier link');
    await expect(halden.locator('[data-state-badge="documentExpiringSoon"]')).toHaveText('Expires within 60 days');
    await halden.getByRole('button', { name: 'Open document Material certificate from Halden Electronics' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'In this preview no file is served.' })).toBeVisible();

    const pending = documentCard(page, 'Liability insurance certificate from Lindqvist Sheet Metal');
    await expect(pending.getByRole('button', { name: /^Open document/ })).toBeDisabled();
    await expect(pending.getByRole('button', { name: /^Open document/ })).toHaveAccessibleDescription(
      'The malware scan has not finished, so the document cannot be opened or reviewed yet.',
    );
    await expect(pending.getByRole('button', { name: /^Confirm/ })).toBeDisabled();
  });

  test('an undated attestation counts for twelve months from its issue', async ({ page }) => {
    await page.goto('/evidence');
    await expect(documentCard(page, 'Forced labour attestation from Arbor Fasteners')).toContainText(
      'Sep 15, 2027, 12 months from issue (undated attestation)',
    );
  });

  test('evidence rejection requires a reason before the action enables', async ({ page }) => {
    await page.goto('/evidence');
    const kestrel = documentCard(page, 'Quality management certificate from Kestrel Machining');
    await kestrel.getByRole('button', { name: /^Reject/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Reject Quality management certificate' });
    const reject = dialog.getByRole('button', { name: 'Reject document' });
    await expect(reject).toBeDisabled();
    await expect(reject).toHaveAccessibleDescription('Enter a reason to reject the document.');
    await dialog.getByRole('textbox', { name: 'Reason for rejecting' }).fill('   ');
    await expect(reject).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Reason for rejecting' }).fill('The certificate names another company.');
    await expect(reject).toBeEnabled();
    await reject.click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('status').filter({ hasText: 'Rejected Quality management certificate from Kestrel Machining.' }),
    ).toBeFocused();
    await expect(kestrel).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Awaiting confirmation (4)' })).toBeVisible();
  });

  test('confirming a document takes it out of the queue', async ({ page }) => {
    await page.goto('/evidence');
    const birchfield = documentCard(page, 'Quality management certificate from Birchfield Precision');
    await expect(birchfield).toContainText('Dana Whitfield (staff)');
    await birchfield.getByRole('button', { name: /^Confirm/ }).click();
    await expect(birchfield).toHaveCount(0);
    await expect(
      page.getByRole('status').filter({ hasText: 'Confirmed Quality management certificate' }),
    ).toBeFocused();
  });

  test('a quality engineer records a time-limited deviation with a reason', async ({ page }) => {
    await page.goto('/evidence');
    const gaps = page.getByRole('grid', { name: 'Evidence gaps' });
    const arbor = gaps.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Arbor Fasteners' }) });
    await expect(arbor).toContainText('Covered by a deviation');
    await expect(arbor.getByRole('button', { name: /^Record deviation/ })).toHaveAccessibleDescription(
      'An active deviation already covers this gap until Nov 30, 2026.',
    );

    const kestrel = gaps.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Kestrel Machining' }) });
    await kestrel
      .getByRole('button', { name: 'Record deviation for Quality management certificate from Kestrel Machining' })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Record a deviation' });
    await dialog.getByRole('button', { name: 'Record deviation' }).click();
    await expect(dialog.getByText('Explain why the gap is acceptable for now.')).toBeVisible();
    await expect(dialog.getByText('Choose the last day the deviation is active.')).toBeVisible();

    await dialog.getByRole('textbox', { name: 'Reason' }).fill('The renewal audit is booked for October.');
    await dialog.getByLabel('Active until').fill('2027-06-30');
    await dialog.getByRole('button', { name: 'Record deviation' }).click();
    await expect(dialog.getByText('A deviation can last until Mar 26, 2027 at the latest.')).toBeVisible();
    await dialog.getByLabel('Active until').fill('2026-12-15');
    await dialog.getByRole('button', { name: 'Record deviation' }).click();
    await expect(dialog).toBeHidden();
    await expect(kestrel).toContainText('Covered by a deviation');
    await expect(kestrel).toContainText('Until Dec 15, 2026');
    await expect(page.getByRole('status').filter({ hasText: 'Deviation recorded' })).toBeFocused();
  });
});

// ---------------------------------------------------------------------------------------------
// Accessibility

test.describe('accessibility in both themes', () => {
  const views: readonly (readonly [string, string, (page: Page) => Promise<void>])[] = [
    ['overview', '/', () => Promise.resolve()],
    ['RFQ list', '/rfqs', () => Promise.resolve()],
    [
      'RFQ builder with lines and errors',
      '/rfqs/new',
      async (page) => {
        await page.getByRole('grid', { name: 'Active parts' }).getByRole('button', { name: 'Add PN-10432' }).click();
        await page.getByRole('button', { name: 'Save draft and invite suppliers' }).click();
        await expect(page.getByText('Enter a whole quantity above zero.')).toBeVisible();
      },
    ],
    ['supplier assignment', assignment(rfq.draftWithoutSuppliers), () => Promise.resolve()],
    [
      'supplier assignment with errors',
      assignment(rfq.draftWithoutSuppliers),
      async (page) => {
        await page.getByRole('button', { name: 'Publish RFQ' }).click();
        await expect(page.getByText('Invite at least one supplier to this line.').first()).toBeVisible();
      },
    ],
    ['open RFQ detail with its changes', detail(rfq.open), () => Promise.resolve()],
    [
      'extend dialog',
      detail(rfq.open),
      async (page) => {
        await page.getByRole('button', { name: 'Extend the deadline' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Extend' }).click();
        await expect(page.getByText('Say why the deadline moves.')).toBeVisible();
      },
    ],
    [
      'amend dialog',
      detail(rfq.open),
      async (page) => {
        await page.getByRole('button', { name: 'Amend a line' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
      },
    ],
    ['closed RFQ detail', detail(rfq.closed), () => Promise.resolve()],
    ['parts list', '/parts', () => Promise.resolve()],
    ['parts list without matches', '/parts?q=zzz', () => Promise.resolve()],
    ['supplier list', '/suppliers', () => Promise.resolve()],
    ['evidence review', '/evidence', () => Promise.resolve()],
    [
      'reject dialog',
      '/evidence',
      async (page) => {
        await documentCard(page, 'Quality management certificate from Kestrel Machining')
          .getByRole('button', { name: /^Reject/ })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
      },
    ],
    [
      'deviation dialog with errors',
      '/evidence',
      async (page) => {
        await page.getByRole('button', { name: /^Record deviation for Conflict minerals/ }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Record deviation' }).click();
        await expect(page.getByText('Explain why the gap is acceptable for now.')).toBeVisible();
      },
    ],
    ['empty evidence review', '/evidence?preview=empty', () => Promise.resolve()],
    ['no-permission state', '/suppliers?preview=forbidden', () => Promise.resolve()],
    ['overview in its error state', '/?preview=unavailable', () => Promise.resolve()],
  ];

  for (const [colorScheme, theme] of [
    ['dark', 'dark'],
    ['light', 'light'],
  ] as const) {
    for (const [name, path, prepare] of views) {
      test(`the ${name} has no axe violations in the ${theme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await loaded(page);
        await prepare(page);
        await expectNoAxeViolations(page);
      });
    }
  }
});

// ---------------------------------------------------------------------------------------------
// Keyboard only

test.describe('keyboard only', () => {
  test('the main navigation reaches every secondary screen', async ({ page }) => {
    for (const [link, heading] of [
      ['RFQs', 'RFQs'],
      ['Parts', 'Parts'],
      ['Suppliers', 'Suppliers'],
      ['Evidence', 'Evidence review'],
    ] as const) {
      await page.goto('/');
      await loaded(page);
      await tabTo(page, page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link }));
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('main')).toBeFocused();
    }
  });

  test('the parts list filters and sorts by keyboard alone', async ({ page }) => {
    await page.goto('/parts');
    await tabTo(page, page.getByRole('searchbox', { name: 'Search by part number or description' }));
    await page.keyboard.type('fastener');
    const grid = page.getByRole('grid', { name: 'Parts' });
    await expect(grid.getByRole('rowheader')).toHaveText(['PN-31005']);
    await tabTo(page, grid.getByRole('columnheader', { name: 'Part' }).getByRole('button'));
    await page.keyboard.press('ArrowDown');
    await expect(grid.getByRole('rowheader', { name: 'PN-31005' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(grid.getByRole('gridcell').last()).toBeFocused();
  });

  test('the builder, assignment and publish work by keyboard alone', async ({ page }) => {
    await page.goto('/rfqs/new');
    await loaded(page);
    await tabTo(page, page.getByRole('textbox', { name: 'Title' }));
    await page.keyboard.type('Gasket sets for the spring build');
    await tabTo(page, page.getByLabel('Response deadline (UTC)'));
    // The year segment takes up to six digits, so the arrow key moves on to the time.
    await page.keyboard.type('10302030');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('0400PM');
    await expect(page.getByLabel('Response deadline (UTC)')).toHaveValue('2030-10-30T16:00');

    const parts = page.getByRole('grid', { name: 'Active parts' });
    await tabTo(page, parts.getByRole('columnheader', { name: 'Part' }).getByRole('button'));
    for (let row = 0; row < 7; row += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await page.keyboard.press('End');
    const add = parts.getByRole('button', { name: 'Add PN-31006' });
    await expect(add).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(parts.getByRole('button', { name: 'Remove PN-31006' })).toBeFocused();

    await tabTo(page, lineGroup(page, 1).getByRole('textbox', { name: 'Quantity (each)' }));
    await page.keyboard.type('1000');
    await tabTo(page, lineGroup(page, 1).getByLabel('Required by'));
    await page.keyboard.type('11202030');
    await tabTo(page, page.getByRole('button', { name: 'Save draft and invite suppliers' }));
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { level: 1, name: /Supplier assignment/ })).toBeVisible();
    await tabTo(page, lineGroup(page, 1).getByRole('checkbox', { name: 'Birchfield Precision' }));
    await page.keyboard.press('Space');
    await expect(lineGroup(page, 1).getByRole('checkbox', { name: 'Birchfield Precision' })).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Publish RFQ' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: /RFQ detail/ })).toBeVisible();
    await expect(page.getByRole('grid', { name: /Supplier responses/ }).getByRole('rowheader')).toHaveText([
      'Birchfield Precision',
    ]);
  });

  test('an evidence document is rejected with a reason by keyboard alone', async ({ page }) => {
    await page.goto('/evidence');
    const halden = documentCard(page, 'Material certificate from Halden Electronics');
    await tabTo(page, halden.getByRole('button', { name: /^Reject/ }));
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Reject Material certificate' });
    await expect(dialog.getByRole('textbox', { name: 'Reason for rejecting' })).toBeFocused();
    await page.keyboard.type('The certificate does not state the alloy grade.');
    await tabTo(page, dialog.getByRole('button', { name: 'Reject document' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Rejected Material certificate' })).toBeFocused();
  });

  test('the extend dialog opens, cancels and returns focus by keyboard alone', async ({ page }) => {
    await page.goto(detail(rfq.open));
    const extend = page.getByRole('button', { name: 'Extend the deadline' });
    await tabTo(page, extend);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Extend the deadline' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(extend).toBeFocused();
  });
});
