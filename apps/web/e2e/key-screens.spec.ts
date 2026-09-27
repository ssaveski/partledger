import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

// The fixture RFQs of libs/contracts/src/fixtures/rfqs.ts, one per scenario.
function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

const rfq = {
  open: fixtureId(1042),
  closed: fixtureId(1038),
  blockedApproval: fixtureId(1031),
  readyApproval: fixtureId(1027),
  draftWithoutSuppliers: fixtureId(1050),
  forbidden: fixtureId(9403),
  unavailable: fixtureId(9503),
  slow: fixtureId(9102),
  unknown: fixtureId(4040),
};

const detail = (id: string) => `/rfqs/${id}`;
const comparison = (id: string) => `/rfqs/${id}/comparison`;
const approval = (id: string) => `/rfqs/${id}/approval`;

const cellStateLabels = {
  bestPrice: 'Best price',
  submitted: 'Submitted',
  alternate: 'Alternate part',
  noQuote: 'No quote',
  pending: 'Pending',
  stale: 'Stale: line changed since',
  late: 'Late: refused after the deadline',
} as const;

function quotesGrid(page: Page): Locator {
  return page.getByRole('grid', { name: 'Quotes for RFQ-1038' });
}

function lineRow(page: Page, line: number): Locator {
  return quotesGrid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: new RegExp(`^Line ${line}\\b`) }) });
}

/** The cell of a supplier column in a line row, found through the column header's position. */
async function supplierCell(page: Page, line: number, supplier: string): Promise<Locator> {
  await expect(quotesGrid(page)).toBeVisible();
  const headers = quotesGrid(page).getByRole('columnheader');
  const names = await headers.allInnerTexts();
  const column = names.findIndex((name) => name.startsWith(supplier));
  expect(column).toBeGreaterThan(0);
  return lineRow(page, line).locator('th, td').nth(column);
}

function decision(page: Page, line: number): Locator {
  return page.getByRole('group', { name: new RegExp(`^Line ${line}\\b`) });
}

async function chooseWinner(page: Page, line: number, option: string | RegExp): Promise<void> {
  await decision(page, line).getByRole('combobox', { name: 'Winner' }).click();
  await page.getByRole('option', { name: option }).click();
}

/** Presses Tab until the target has focus, as a keyboard-only person would. */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('The target never received focus by Tab');
}

function nothingToPrepare(): Promise<void> {
  return Promise.resolve();
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

test.describe('quote comparison', () => {
  test('the comparison highlights the lowest total on each line and has no winner selected on load', async ({
    page,
  }) => {
    await page.goto(comparison(rfq.closed));
    await expect(page.getByRole('heading', { level: 1, name: /Quote comparison/ })).toBeVisible();
    await expect(
      page.getByText('The lowest total on each line is highlighted, but it is never chosen for you.'),
    ).toBeVisible();

    const lowest = [
      [1, 'Birchfield Precision', '$10,880.00'],
      [2, 'Northwind Castings', '$4,200.00'],
      [3, 'Birchfield Precision', '$10,980.00'],
      [4, 'Birchfield Precision', '$7,700.00'],
      [5, 'Birchfield Precision', '$1,950.00'],
    ] as const;
    for (const [line, supplier, total] of lowest) {
      await expect(lineRow(page, line).getByRole('gridcell', { name: /Best price/ })).toHaveCount(1);
      const cell = await supplierCell(page, line, supplier);
      await expect(cell).toContainText('Best price');
      await expect(cell).toContainText(total);
    }

    const winners = page.getByRole('combobox', { name: 'Winner' });
    await expect(winners).toHaveCount(5);
    for (const winner of await winners.all()) {
      await expect(winner).toHaveText(/Choose a winner/);
    }
    await expect(page.getByRole('textbox', { name: 'Justification' })).toHaveCount(0);
  });

  test('a lower unit price that loses once the minimum order quantity applies is not highlighted', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    const arbor = await supplierCell(page, 4, 'Arbor Fasteners');
    await expect(arbor).toContainText('$3.40 each');
    await expect(arbor).toContainText('Submitted');
    await expect(arbor).not.toContainText('Best price');
  });

  test('choosing a winner that is not the lowest shows a required justification, and submitting without it shows the field error', async ({
    page,
  }) => {
    await page.goto(comparison(rfq.closed));
    await chooseWinner(page, 1, 'Birchfield Precision, $10,880.00 (lowest total)');
    await expect(decision(page, 1).getByRole('textbox', { name: 'Justification' })).toHaveCount(0);

    await chooseWinner(page, 1, 'Northwind Castings, $11,650.00');
    const justification = decision(page, 1).getByRole('textbox', { name: 'Justification' });
    await expect(justification).toBeVisible();
    await expect(justification).toHaveAccessibleDescription(
      /Explain why this supplier wins instead of the lowest total, Birchfield Precision at \$10,880\.00\./,
    );

    await chooseWinner(page, 2, 'No award for this line');
    await chooseWinner(page, 3, /^Birchfield Precision/);
    await chooseWinner(page, 4, /^Birchfield Precision/);
    await chooseWinner(page, 5, /^Birchfield Precision/);
    await page.getByRole('button', { name: 'Submit for approval' }).click();

    await expect(
      decision(page, 1).getByText('Explain why this winner was chosen over the lowest total.'),
    ).toBeVisible();
    await expect(justification).toHaveAttribute('aria-invalid', 'true');
    await expect(justification).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Every line is decided' })).toHaveCount(0);

    await justification.fill('Birchfield cannot deliver before the line date.');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByText('Every line is decided. In this preview the award is not saved')).toBeVisible();
  });

  test('a line without a decision shows its field error when the award is submitted', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    for (const line of [1, 2, 3, 4, 5]) {
      await expect(decision(page, line).getByText('Choose a winner or no award for this line.')).toBeVisible();
    }
    await expect(decision(page, 1).getByRole('combobox', { name: 'Winner' })).toBeFocused();
  });

  test('an alternate awaiting quality acceptance cannot win, while an accepted alternate can', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    await decision(page, 2).getByRole('combobox', { name: 'Winner' }).click();
    await expect(page.getByRole('option', { name: /^Birchfield Precision/ })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await decision(page, 5).getByRole('combobox', { name: 'Winner' }).click();
    await expect(page.getByRole('option', { name: 'Arbor Fasteners, $2,100.00' })).toBeVisible();
  });

  test('each of the seven comparison cell states exposes an accessible name matching its legend entry', async ({
    page,
  }) => {
    await page.goto(comparison(rfq.closed));
    for (const [state, label] of Object.entries(cellStateLabels)) {
      await expect(page.locator(`[data-legend-entry="${state}"]`)).toHaveText(label);
      const badge = quotesGrid(page).locator(`[data-state-badge="${state}"]`).first();
      await expect(badge).toHaveText(label);
      await expect(
        quotesGrid(page)
          .getByRole('gridcell', { name: new RegExp(label) })
          .first(),
      ).toBeVisible();
    }
    await expect(page.locator('[data-legend-entry="buyerRecorded"]')).toHaveText('Recorded by a buyer');
    await expect(
      (await supplierCell(page, 4, 'Birchfield Precision')).locator('[data-state-badge="buyerRecorded"]'),
    ).toHaveText('Recorded by a buyer');
  });

  test('each supplier column shows its evidence status', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    const headers = quotesGrid(page).getByRole('columnheader');
    await expect(headers.filter({ hasText: 'Northwind Castings' })).toContainText('Evidence valid');
    await expect(headers.filter({ hasText: 'Birchfield Precision' })).toContainText('Evidence expiring');
    await expect(headers.filter({ hasText: 'Kestrel Machining' })).toContainText('Evidence missing or invalid');
    await expect(headers.filter({ hasText: 'Arbor Fasteners' })).toContainText('Evidence under deviation');
  });

  test('a quote received outside the portal is recorded after close and carries the buyer-recorded marker', async ({
    page,
  }) => {
    await page.goto(comparison(rfq.closed));
    await expect(page.getByRole('main')).toContainText('Sep 24, 2026, 16:00 UTC');
    const action = page.getByRole('button', { name: 'Record outside quote from Kestrel Machining for line 4' });
    await expect(action).toHaveAccessibleDescription('Pending');
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Record a quote received outside the portal' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: 'Record quote' }).click();
    await expect(dialog.getByText('Enter the unit price as a number greater than zero')).toBeVisible();
    await expect(dialog.getByText("Attach the supplier's quote document.")).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Unit price' })).toBeFocused();

    await dialog.getByRole('textbox', { name: 'Unit price' }).fill('3.30');
    await dialog.getByRole('textbox', { name: 'Lead time in days' }).fill('20');
    await dialog.getByLabel('Valid until').fill('2026-12-31');
    // RFQ-1038 closed early on 22 September; its deadline was 24 September, which is what counts.
    await dialog.getByLabel('Received on').fill('2026-09-25');
    await dialog.getByLabel("Supplier's quote document").setInputFiles({
      name: 'kestrel-quote.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('synthetic'),
    });
    await dialog.getByRole('button', { name: 'Record quote' }).click();
    await expect(dialog.getByText('This quote arrived after the deadline, so it cannot be recorded.')).toBeVisible();
    await expect(dialog.getByText('Attach the quote as a PDF, PNG or JPEG file.')).toBeVisible();

    await dialog.getByLabel("Supplier's quote document").setInputFiles({
      name: 'kestrel-quote.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 synthetic'),
    });
    await dialog.getByLabel('Received on').fill('2026-09-23');
    await dialog.getByRole('button', { name: 'Record quote' }).click();
    await expect(dialog).toBeHidden();

    const status = page.getByRole('status').filter({ hasText: 'Quote from Kestrel Machining for line 4 recorded' });
    await expect(status).toBeFocused();
    const kestrel = await supplierCell(page, 4, 'Kestrel Machining');
    await expect(kestrel).toContainText('Best price');
    await expect(kestrel).toContainText('$6,600.00');
    await expect(kestrel).toContainText('Recorded by a buyer');
    await expect(await supplierCell(page, 4, 'Birchfield Precision')).toContainText('Submitted');
    await expect(
      page.getByRole('button', { name: 'Record outside quote from Kestrel Machining for line 4' }),
    ).toHaveCount(0);
    await decision(page, 4).getByRole('combobox', { name: 'Winner' }).click();
    await expect(
      page.getByRole('option', {
        name: 'Kestrel Machining, $6,600.00 (lowest total), recorded by a buyer',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('the outside-quote action in a late cell names the state of that cell', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    await expect(
      page.getByRole('button', { name: 'Record outside quote from Kestrel Machining for line 3' }),
    ).toHaveAccessibleDescription('Late: refused after the deadline');
    await expect(
      page.getByRole('button', { name: 'Record outside quote from Northwind Castings for line 3' }),
    ).toHaveAccessibleDescription('Stale: line changed since');
  });

  test('winner options name an alternate part and a quote recorded by a buyer', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    await decision(page, 4).getByRole('combobox', { name: 'Winner' }).click();
    await expect(
      page.getByRole('option', {
        name: 'Birchfield Precision, $7,700.00 (lowest total), recorded by a buyer',
        exact: true,
      }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await decision(page, 5).getByRole('combobox', { name: 'Winner' }).click();
    await expect(
      page.getByRole('option', { name: 'Arbor Fasteners, $2,100.00, alternate part PN-31006-N2', exact: true }),
    ).toBeVisible();
  });

  test('cancelling the outside-quote dialog returns focus to the action that opened it', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    const action = page.getByRole('button', { name: 'Record outside quote from Northwind Castings for line 5' });
    await action.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(action).toBeFocused();
  });

  test('an RFQ that is still open shows no answers and no outside-quote action', async ({ page }) => {
    await page.goto(comparison(rfq.open));
    await expect(
      page.getByRole('heading', { level: 2, name: 'Quotes open for comparison when the RFQ closes' }),
    ).toBeVisible();
    await expect(page.getByRole('grid')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Record outside quote/ })).toHaveCount(0);
    await page.getByRole('link', { name: 'See response status' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /RFQ detail/ })).toBeVisible();
  });

  test('while an award awaits approval the comparison offers no outside-quote action and explains why it cannot be submitted', async ({
    page,
  }) => {
    await page.goto(comparison(rfq.blockedApproval));
    await expect(page.getByRole('grid', { name: 'Quotes for RFQ-1031-R2' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Record outside quote/ })).toHaveCount(0);
    const submit = page.getByRole('button', { name: 'Submit for approval' });
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAccessibleDescription('An award for this RFQ is waiting for approval.');
  });
});

test.describe('RFQ detail', () => {
  test("an open RFQ's detail shows responded or not yet per supplier and no prices", async ({ page }) => {
    await page.goto(detail(rfq.open));
    await expect(page.getByRole('heading', { level: 1, name: /RFQ detail/ })).toBeVisible();
    await expect(page.getByText('Answers stay sealed until the RFQ closes.')).toBeVisible();
    await expect(page).toHaveTitle('RFQ-1042 detail · Partledger');
    const grid = page.getByRole('grid', { name: 'Supplier responses to RFQ-1042' });
    const expected = [
      ['Northwind Castings', 'Responded'],
      ['Birchfield Precision', 'Not yet'],
      ['Kestrel Machining', 'Responded'],
      ['Arbor Fasteners', 'Not yet'],
    ] as const;
    for (const [supplier, response] of expected) {
      const row = grid.getByRole('row').filter({ has: page.getByRole('rowheader', { name: supplier }) });
      await expect(row.getByRole('gridcell', { name: response, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('main')).not.toContainText(/\$|€|US\$|each,|Best price|Submitted/);
  });

  test('the response list can show only the suppliers still to respond', async ({ page }) => {
    await page.goto(detail(rfq.open));
    await page.getByRole('link', { name: 'Not yet responded (2)' }).click();
    await expect(page).toHaveURL(/\?show=notYet$/);
    const grid = page.getByRole('grid', { name: 'Supplier responses to RFQ-1042' });
    await expect(grid.getByRole('rowheader')).toHaveText(['Birchfield Precision', 'Arbor Fasteners']);
    await expect(page.getByRole('link', { name: 'Not yet responded (2)' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'All suppliers (4)' })).not.toHaveAttribute('aria-current');
  });

  test('a draft without suppliers shows the empty state with its next action', async ({ page }) => {
    await page.goto(detail(rfq.draftWithoutSuppliers));
    await expect(page.getByRole('heading', { level: 3, name: 'No suppliers invited yet' })).toBeVisible();
    await expect(page.getByRole('grid', { name: /Supplier responses/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to the overview' })).toBeVisible();
  });
});

test.describe('approval packet', () => {
  test('an approval packet with a blocked gate lists its blocking reasons and disables approve with its reason', async ({
    page,
  }) => {
    await page.goto(approval(rfq.blockedApproval));
    await expect(page.getByRole('heading', { level: 1, name: /Approval packet/ })).toBeVisible();
    await expect(page.getByText('The gate is blocked. Blocking reasons: 1.')).toBeVisible();
    const blocked = page.locator('[data-gate-check="evidence"]');
    await expect(blocked).toContainText('Blocked');
    await expect(blocked).toContainText("Kestrel Machining's quality certificate QC-4471 expired on 2026-09-24.");

    const approve = page.getByRole('button', { name: 'Approve and seal' });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAccessibleDescription(
      'Approval is blocked until the gate passes. Blocking reasons: 1.',
    );
    await expect(page.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  test('a re-bid shows its previous round, and each winner shows its evidence status', async ({ page }) => {
    await page.goto(approval(rfq.blockedApproval));
    const previous = page.getByRole('region', { name: 'Previous round' });
    await expect(previous).toContainText('RFQ-1031');
    await expect(previous).toContainText('Only one quote arrived before the drawing revision changed');
    const line2 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: /^Line 2/ }) });
    await expect(line2).toContainText('Kestrel Machining');
    await expect(line2).toContainText('Expired');
    await expect(line2).toContainText('The lowest quote has a 16-week lead time');
  });

  test('a packet whose gate passes shows an active deviation and a buyer-recorded winner, and approve is enabled', async ({
    page,
  }) => {
    await page.goto(approval(rfq.readyApproval));
    await expect(page.getByText('Every gate check passes.')).toBeVisible();
    const line2 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: /^Line 2/ }) });
    await expect(line2).toContainText('Active deviation');
    await expect(line2).toContainText('Covers the Forced-labour attestation until Nov 30, 2026.');
    await expect(line2).toContainText('Covered by deviation');
    await expect(line2).toContainText('Offers PN-31006-N2');
    await expect(line2).toContainText('Accepted by quality');
    const line3 = page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 3, name: /^Line 3/ }) });
    await expect(line3).toContainText('Recorded by a buyer');
    await expect(page.getByRole('region', { name: 'Previous round' })).toHaveCount(0);
    const approve = page.getByRole('button', { name: 'Approve and seal' });
    await expect(approve).toBeEnabled();
    await expect(page.getByRole('main')).toContainText('1.3642 CAD, reference rate of 2026-09-22');
    await approve.click();
    const outcome =
      'In this preview nothing is approved or sealed. Approval will ask you to confirm your identity first.';
    await expect(page.getByRole('status').filter({ hasText: outcome })).toBeVisible();
    // One decision per packet: both actions close once it is made.
    await expect(approve).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reject' })).toHaveAccessibleDescription(outcome);
  });

  test('an RFQ without a submitted award shows the empty state with its next action', async ({ page }) => {
    await page.goto(approval(rfq.closed));
    await expect(page.getByRole('heading', { level: 2, name: 'No award is waiting for approval' })).toBeVisible();
    await page.getByRole('link', { name: 'Open the quote comparison' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Quote comparison/ })).toBeVisible();
  });
});

test.describe('designed states', () => {
  const screens = [
    ['RFQ detail', detail, 'Loading the RFQ…', 'RFQ detail'],
    ['quote comparison', comparison, 'Loading the quotes…', 'Quote comparison'],
    ['approval packet', approval, 'Loading the approval packet…', 'Approval packet'],
  ] as const;

  for (const [name, path, loading, title] of screens) {
    test(`the ${name} shows its loading state while the read is in flight`, async ({ page }) => {
      await page.goto(path(rfq.slow));
      await expect(page.getByRole('status').filter({ hasText: loading })).toBeVisible();
      await expect(page).toHaveTitle(`${title} · Partledger`);
      await expectNoAxeViolations(page);
    });

    test(`the ${name} shows an error state with a retry when the read fails`, async ({ page }) => {
      await page.goto(path(rfq.unavailable));
      await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
      await expect(page.getByRole('alert')).toContainText('A service this action needs is unavailable.');
      await expect(page).toHaveTitle(`Something went wrong: ${title} · Partledger`);
      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
    });

    test(`the ${name} shows the no-permission state when the server refuses the reader`, async ({ page }) => {
      await page.goto(path(rfq.forbidden));
      await expect(page.getByRole('heading', { level: 1, name: 'You do not have access to this' })).toBeVisible();
      await expect(page).toHaveTitle(`No access: ${title} · Partledger`);
    });

    test(`the ${name} of an RFQ that does not exist says it could not be found`, async ({ page }) => {
      await page.goto(path(rfq.unknown));
      await expect(page.getByRole('alert')).toContainText('We could not find that record.');
    });
  }

  test('an address that cannot name an RFQ shows the page-not-found state', async ({ page }) => {
    await page.goto('/rfqs/not-an-id/comparison');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
  });
});

test.describe('accessibility in both themes', () => {
  const views: readonly (readonly [string, string, (page: Page) => Promise<void>])[] = [
    ['overview', '/', nothingToPrepare],
    ['open RFQ detail', detail(rfq.open), nothingToPrepare],
    ['draft RFQ detail', detail(rfq.draftWithoutSuppliers), nothingToPrepare],
    ['closed comparison', comparison(rfq.closed), nothingToPrepare],
    [
      'comparison with field errors',
      comparison(rfq.closed),
      async (page) => {
        await chooseWinner(page, 1, 'Northwind Castings, $11,650.00');
        await page.getByRole('button', { name: 'Submit for approval' }).click();
        await expect(decision(page, 1).getByText('Explain why this winner')).toBeVisible();
      },
    ],
    [
      'outside-quote dialog with errors',
      comparison(rfq.closed),
      async (page) => {
        await page.getByRole('button', { name: 'Record outside quote from Kestrel Machining for line 4' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Record quote' }).click();
        await expect(page.getByRole('dialog').getByText("Attach the supplier's quote document.")).toBeVisible();
      },
    ],
    ['open comparison', comparison(rfq.open), nothingToPrepare],
    ['blocked approval packet', approval(rfq.blockedApproval), nothingToPrepare],
    ['ready approval packet', approval(rfq.readyApproval), nothingToPrepare],
    ['no award to approve', approval(rfq.closed), nothingToPrepare],
    ['error state', comparison(rfq.unavailable), nothingToPrepare],
    ['no-permission state', approval(rfq.forbidden), nothingToPrepare],
    ['page not found', '/rfqs/not-an-id', nothingToPrepare],
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
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: /^Loading/ })).toHaveCount(0);
        await prepare(page);
        await expectNoAxeViolations(page);
      });
    }
  }
});

test.describe('keyboard only', () => {
  test('the theme switcher changes and remembers the theme by keyboard', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const theme = page.getByRole('combobox', { name: 'Theme' });
    await tabTo(page, theme);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Light' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveText(/Light/);
  });

  test('a skip link moves focus past the navigation to the main content', async ({ page }) => {
    await page.goto(detail(rfq.open));
    await expect(page.getByRole('grid', { name: 'Supplier responses to RFQ-1042' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Detail', exact: true })).toBeFocused();
  });

  test('the RFQ detail filters its responses by keyboard alone', async ({ page }) => {
    await page.goto('/');
    await tabTo(page, page.getByRole('link', { name: 'Detail for Open RFQ' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: /RFQ detail/ })).toBeVisible();
    await expect(page.getByRole('main')).toBeFocused();
    await tabTo(page, page.getByRole('link', { name: 'Not yet responded (2)' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\?show=notYet$/);
    const grid = page.getByRole('grid', { name: 'Supplier responses to RFQ-1042' });
    await tabTo(page, grid.getByRole('columnheader').first().getByRole('button'));
    await page.keyboard.press('ArrowDown');
    await expect(grid.getByRole('rowheader', { name: 'Birchfield Precision' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(grid.getByRole('gridcell', { name: 'None yet' }).first()).toBeFocused();
  });

  test('the comparison records an outside quote and decides every line by keyboard alone', async ({ page }) => {
    await page.goto(comparison(rfq.closed));
    await expect(quotesGrid(page)).toBeVisible();

    // One tab stop into the grid, then arrow keys to line 4's Kestrel Machining cell.
    await tabTo(page, quotesGrid(page).getByRole('columnheader', { name: 'Line' }));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    for (let column = 0; column < 5; column += 1) {
      await page.keyboard.press('ArrowRight');
    }
    const record = page.getByRole('button', { name: 'Record outside quote from Kestrel Machining for line 4' });
    await expect(record).toBeFocused();
    await expect(record).toHaveAccessibleDescription('Pending');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Record a quote received outside the portal' });
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole('textbox', { name: 'Unit price' }));
    await page.keyboard.type('3.30');
    await tabTo(page, dialog.getByRole('textbox', { name: 'Lead time in days' }));
    await page.keyboard.type('20');
    await tabTo(page, dialog.getByLabel('Valid until'));
    await page.keyboard.type('12312026');
    await tabTo(page, dialog.getByLabel('Received on'));
    await page.keyboard.type('09212026');
    await tabTo(page, dialog.getByLabel("Supplier's quote document"));
    const chooser = page.waitForEvent('filechooser');
    await page.keyboard.press('Space');
    await (
      await chooser
    ).setFiles({
      name: 'kestrel-quote.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7 synthetic'),
    });
    await tabTo(page, dialog.getByRole('button', { name: 'Record quote' }));
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: 'Quote from Kestrel Machining' })).toBeFocused();

    const winners: readonly (readonly [number, string])[] = [
      [1, 'Northwind Castings, $11,650.00'],
      [2, 'No award for this line'],
      [3, 'Birchfield Precision, $10,980.00 (lowest total)'],
      [4, 'Kestrel Machining, $6,600.00 (lowest total), recorded by a buyer'],
      [5, 'Birchfield Precision, $1,950.00 (lowest total)'],
    ];
    for (const [line, option] of winners) {
      await tabTo(page, decision(page, line).getByRole('combobox', { name: 'Winner' }));
      await page.keyboard.press('Enter');
      const target = page.getByRole('option', { name: option, exact: true });
      await expect(target).toBeVisible();
      for (let presses = 0; presses < 8; presses += 1) {
        if (await target.evaluate((element) => element.hasAttribute('data-highlighted'))) {
          break;
        }
        await page.keyboard.press('ArrowDown');
      }
      await page.keyboard.press('Enter');
      await expect(decision(page, line).getByRole('combobox', { name: 'Winner' })).toHaveText(option);
      if (line === 1) {
        await tabTo(page, decision(page, 1).getByRole('textbox', { name: 'Justification' }));
        await page.keyboard.type('Birchfield cannot deliver before the line date.');
      }
    }
    await tabTo(page, page.getByRole('button', { name: 'Submit for approval' }));
    await page.keyboard.press('Enter');
    await expect(page.getByText('Every line is decided. In this preview the award is not saved')).toBeVisible();
  });

  test('the approval packet reaches a disabled action and its reason, and rejects, by keyboard alone', async ({
    page,
  }) => {
    await page.goto(approval(rfq.blockedApproval));
    const approve = page.getByRole('button', { name: 'Approve and seal' });
    await tabTo(page, approve);
    await expect(approve).toHaveAccessibleDescription(
      'Approval is blocked until the gate passes. Blocking reasons: 1.',
    );
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'In this preview' })).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reject' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'Rejecting returns the RFQ to selection.' })).toBeVisible();
  });
});
