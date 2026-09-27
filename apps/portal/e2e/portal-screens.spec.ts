import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

// The fixture links of libs/contracts/src/fixtures/portal.ts, one per scenario.
function fixtureId(serial: number): string {
  return `00000000-0000-4000-8000-${serial.toString().padStart(12, '0')}`;
}

const scenarios = ['open', 'closed', 'sealed', 'evidence', 'expired', 'revoked', 'slow', 'unavailable'] as const;

type Scenario = (typeof scenarios)[number];

function linkId(scenario: Scenario): string {
  return fixtureId(7001 + scenarios.indexOf(scenario));
}

function secret(scenario: Scenario): string {
  return `fixture-${scenario}-`.padEnd(43, 'x');
}

function linkUrl(scenario: Scenario, withSecret = secret(scenario)): string {
  return `/link/${linkId(scenario)}#${withSecret}`;
}

const linkUnavailable = 'This link is no longer available';

async function openLink(page: Page, scenario: Scenario): Promise<void> {
  await page.goto(linkUrl(scenario));
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
}

function line(page: Page, number: number): Locator {
  return page.getByRole('group', { name: new RegExp(`^Line ${number}\\b`) });
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
}

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

test.describe('the link landing page', () => {
  test('the landing page issues no mutating request until Continue is pressed', async ({ page, baseURL }) => {
    const requests: Request[] = [];
    page.on('request', (request) => {
      requests.push(request);
    });
    const response = await page.goto(linkUrl('open'));
    expect(response?.headers()['referrer-policy']).toBe('no-referrer');
    expect(response?.headers()['cache-control']).toBe('no-store');
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
    await expect(page.getByRole('heading', { level: 1, name: 'Open your secure link' })).toBeVisible();
    await expect(page.getByText('Loading this page records nothing and tells no one.')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const beforeContinue = [...requests];
    expect(beforeContinue.length).toBeGreaterThan(0);
    expect(beforeContinue.filter((request) => request.method() !== 'GET')).toEqual([]);
    expect(beforeContinue.filter((request) => new URL(request.url()).pathname.startsWith('/api/'))).toEqual([]);
    // No third-party scripts, fonts or beacons: everything comes from the portal's own origin.
    expect(beforeContinue.filter((request) => !request.url().startsWith(baseURL ?? 'missing'))).toEqual([]);
    expect(beforeContinue.filter((request) => request.url().includes(secret('open')))).toEqual([]);
    expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0);
    expect(new URL(page.url()).hash).toBe(`#${secret('open')}`);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Your response/ })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/respond');
    expect(new URL(page.url()).hash).toBe('');
    expect(requests.filter((request) => request.url().includes(secret('open')))).toEqual([]);
  });

  test('the secret is removed from the address and history once Continue is pressed', async ({ page }) => {
    await page.goto(linkUrl('closed'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Your last submission/ })).toBeVisible();
    await page.goBack();
    expect(page.url()).not.toContain(secret('closed'));
  });

  for (const [name, url] of [
    ['an expired link', linkUrl('expired')],
    ['a revoked link', linkUrl('revoked')],
    ['a link with a wrong secret', linkUrl('open', secret('closed'))],
  ] as const) {
    test(`${name} shows the link no longer available state with no retry action`, async ({ page }) => {
      await page.goto(url);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByRole('heading', { level: 1, name: linkUnavailable })).toBeVisible();
      await expect(page.getByRole('main')).toContainText('Contact the buyer who sent it and ask them for a new link.');
      await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('main').getByRole('link')).toHaveCount(0);
      await expect(page).toHaveTitle(`${linkUnavailable} · Partledger supplier portal`);
    });
  }

  test('a link without its secret shows the link no longer available state without sending anything', async ({
    page,
  }) => {
    await page.goto(`/link/${linkId('open')}`);
    await expect(page.getByRole('heading', { level: 1, name: linkUnavailable })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });

  test('a screen opened without a session shows the link no longer available state', async ({ page }) => {
    await page.goto('/respond');
    await expect(page.getByRole('heading', { level: 1, name: linkUnavailable })).toBeVisible();
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  });
});

test.describe('the response form', () => {
  test('a fixture supplier sees only its three assigned lines', async ({ page }) => {
    await openLink(page, 'open');
    await expect(page.getByRole('heading', { level: 1, name: /Your response/ })).toBeVisible();
    await expect(page.getByText("You see only your own organisation's lines and outcomes.")).toBeVisible();
    const lines = page.getByRole('group', { name: /^Line \d+/ });
    await expect(lines).toHaveCount(3);
    await expect(line(page, 1)).toContainText('PN-10432');
    await expect(line(page, 3)).toContainText('PN-20877');
    await expect(line(page, 4)).toContainText('PN-31005');
    // Lines 2 and 5 of RFQ-1060 are assigned to another supplier only.
    await expect(page.getByRole('main')).not.toContainText('PN-10433');
    await expect(page.getByRole('main')).not.toContainText('PN-31006');
    await expect(page.getByRole('main')).not.toContainText('Kestrel');
    await expect(page.getByText('2 of 3 lines answered')).toBeVisible();
  });

  test('the deadline shows in the supplier time zone with UTC alongside', async ({ page }) => {
    await openLink(page, 'open');
    const deadline = page
      .getByRole('definition')
      .filter({ has: page.locator('time') })
      .first();
    await expect(deadline).toContainText(/Thu, Oct\.? 15, 2026, 13:00 EDT/);
    await expect(deadline).toContainText(/Thu, Oct\.? 15, 2026, 17:00 UTC/);
    await expect(
      page.getByText('Times are shown in your time zone (America/Toronto) with UTC beside them.'),
    ).toBeVisible();
  });

  test('a fixture with a stale line shows the changed-line indicator on that line only', async ({ page }) => {
    await openLink(page, 'open');
    const changed = 'This line changed — review and resubmit';
    await expect(page.getByText(changed)).toHaveCount(1);
    await expect(line(page, 3)).toContainText(changed);
    await expect(line(page, 3)).toHaveAccessibleDescription(new RegExp(changed));
    await expect(line(page, 1)).not.toContainText(changed);
    await expect(line(page, 4)).not.toContainText(changed);

    const draft = page.getByTestId('draft-status');
    await expect(draft).toHaveText(/Draft saved/);
    await expect(draft).not.toContainText('changed');

    // Saving a draft is not resubmitting: the changed line keeps its own indicator.
    await line(page, 1)
      .getByRole('textbox', { name: /^Unit price at 200 pieces/ })
      .fill('51.90');
    await expect(draft).toHaveText('Changes not saved yet');
    await expect(draft).toHaveText(/Draft saved/);
    await expect(line(page, 3)).toContainText(changed);
  });

  test('submitting names each missing answer and the declaration, then clears the changed line once resubmitted', async ({
    page,
  }) => {
    await openLink(page, 'open');
    await page.getByRole('button', { name: 'Submit response' }).click();
    await expect(
      line(page, 4).getByText('Choose a quote, a no-quote or an alternate part for this line.'),
    ).toBeVisible();
    await expect(line(page, 4).getByRole('combobox', { name: 'Your answer' })).toBeFocused();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await expect(page.getByText('Confirm that you may submit for your organisation.')).toBeVisible();

    await line(page, 4).getByRole('combobox', { name: 'Your answer' }).click();
    await page.getByRole('option', { name: 'No quote' }).click();
    await line(page, 4).getByRole('combobox', { name: 'Reason for not quoting' }).click();
    await page.getByRole('option', { name: 'Another reason' }).click();
    await page.getByRole('button', { name: 'Submit response' }).click();
    await expect(line(page, 4).getByText('Tell the buyer the reason.')).toBeVisible();
    await line(page, 4).getByRole('textbox', { name: 'Note for the buyer' }).fill('We do not make fastener kits.');
    await page.getByRole('textbox', { name: 'Your full name' }).fill('Morgan Ellery');
    await page
      .getByRole('checkbox', { name: /I am authorised to submit this response on behalf of Birchfield/ })
      .click();
    await page.getByRole('button', { name: 'Submit response' }).click();

    await expect(page.getByRole('status').filter({ hasText: 'submitted in this preview' })).toBeFocused();
    await expect(page.getByText('This line changed — review and resubmit')).toHaveCount(0);
    await expect(page.getByText('3 of 3 lines answered')).toBeVisible();
  });

  test('an alternate part needs its description and prices', async ({ page }) => {
    await openLink(page, 'open');
    await line(page, 4).getByRole('combobox', { name: 'Your answer' }).click();
    await page.getByRole('option', { name: 'Alternate part' }).click();
    await page.getByRole('button', { name: 'Submit response' }).click();
    await expect(line(page, 4).getByText('Describe the alternate part you offer.')).toBeVisible();
    await expect(line(page, 4).getByText('Enter a unit price greater than 0, such as 52.40.')).toHaveCount(2);
    await expect(line(page, 4).getByText('Enter the one-off costs, or 0 if there are none.')).toBeVisible();
  });
});

test.describe('read-only views', () => {
  test('after close the last submission is read-only and records who submitted it and their authority', async ({
    page,
  }) => {
    await openLink(page, 'closed');
    await expect(page.getByRole('heading', { level: 1, name: /Your last submission/ })).toBeVisible();
    await expect(page.getByText('The request has closed, so this submission can no longer be changed.')).toBeVisible();
    const main = page.getByRole('main');
    await expect(main).toContainText('Morgan Ellery');
    await expect(main).toContainText('Declared authorised to submit for Birchfield Precision');
    await expect(page.getByRole('article')).toHaveCount(3);
    await expect(main).toContainText('No capacity before the date needed');
    await expect(main).toContainText('PN-40213-H, hard-anodised finish');
    await expect(main).toContainText('US$142.00');
    await expect(main).not.toContainText('PN-40212');
    for (const role of ['textbox', 'combobox', 'checkbox', 'spinbutton'] as const) {
      await expect(main.getByRole(role)).toHaveCount(0);
    }
    await expect(main.getByRole('button')).toHaveCount(0);
  });

  test('the outcome view shows only its own lines results', async ({ page }) => {
    await openLink(page, 'sealed');
    await expect(page.getByRole('heading', { level: 1, name: /Outcome/ })).toBeVisible();
    const lines = page.getByRole('main').getByRole('list').last().getByRole('listitem');
    await expect(lines).toHaveCount(3);
    await expect(lines.filter({ hasText: 'PN-55120' })).toContainText('Not awarded to you');
    await expect(lines.filter({ hasText: 'PN-55121' })).toContainText('Awarded to you');
    await expect(lines.filter({ hasText: 'PN-55124' })).toContainText('Not awarded to you');
    const main = page.getByRole('main');
    await expect(main).toContainText('1 of your 3 lines were awarded to your organisation.');
    await expect(main).toContainText('This shows the outcome of your own lines only.');
    // Lines 3 and 4 went to another supplier, whose name and prices never reach this one.
    await expect(main).not.toContainText('PN-55122');
    await expect(main).not.toContainText('PN-55123');
    await expect(main).not.toContainText('Kestrel');
    await expect(main).not.toContainText('$');
    for (const role of ['textbox', 'combobox', 'checkbox', 'button'] as const) {
      await expect(main.getByRole(role)).toHaveCount(0);
    }
  });

  test('a sealed request also links its last submission, and a screen the link does not open says so', async ({
    page,
  }) => {
    await openLink(page, 'sealed');
    await page.getByRole('navigation', { name: 'Your request' }).getByRole('link', { name: 'Last submission' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Your last submission/ })).toBeVisible();
    await page.goto('/respond');
    await expect(page.getByRole('heading', { level: 1, name: 'You do not have access to this' })).toBeVisible();
    await expect(page.getByText('Ask the buyer who invited you for access to this page.')).toBeVisible();
  });

  test('the evidence request list shows each document with its status and what to do next', async ({ page }) => {
    await openLink(page, 'evidence');
    await expect(page.getByRole('heading', { level: 1, name: 'Evidence requests' })).toBeVisible();
    const requests = page.getByRole('list', { name: 'Requested documents' }).getByRole('article');
    await expect(requests).toHaveCount(4);
    const rejected = page.getByRole('article', { name: 'Forced-labour attestation' });
    await expect(rejected).toContainText('Rejected');
    await expect(rejected).toContainText('The attestation is not signed.');
    await expect(rejected.getByRole('button', { name: 'Upload Forced-labour attestation' })).toBeDisabled();
    await expect(
      rejected.getByRole('button', { name: 'Upload Forced-labour attestation' }),
    ).toHaveAccessibleDescription('Uploading documents is not available yet.');
    const accepted = page.getByRole('article', { name: 'Certificate of insurance' });
    await expect(accepted).toContainText('Accepted');
    await expect(accepted.getByRole('button')).toHaveCount(0);
  });
});

test.describe('designed states', () => {
  test('the response form shows its loading state while the read is in flight', async ({ page }) => {
    await openLink(page, 'slow');
    await expect(page.getByRole('status').filter({ hasText: 'Loading your response form…' })).toBeVisible();
    await expect(page).toHaveTitle('Your response · Partledger supplier portal');
    await expectNoAxeViolations(page);
  });

  test('the response form shows an error state with a retry when the read fails', async ({ page }) => {
    await openLink(page, 'unavailable');
    await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('A service this action needs is unavailable.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeVisible();
  });

  test('an unknown address points the supplier back to the email', async ({ page }) => {
    await page.goto('/quotes');
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Open the link in the email the buyer sent you.');
  });
});

test.describe('accessibility in both themes', () => {
  const views: readonly (readonly [string, (page: Page) => Promise<void>])[] = [
    ['front page', (page) => page.goto('/').then(() => undefined)],
    ['link landing', (page) => page.goto(linkUrl('open')).then(() => undefined)],
    [
      'link no longer available',
      async (page) => {
        await page.goto(linkUrl('revoked'));
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('heading', { name: linkUnavailable })).toBeVisible();
      },
    ],
    ['response form', (page) => openLink(page, 'open')],
    [
      'response form with errors',
      async (page) => {
        await openLink(page, 'open');
        await line(page, 1).getByRole('combobox', { name: 'Your answer' }).click();
        await page.getByRole('option', { name: 'Alternate part' }).click();
        await page.getByRole('button', { name: 'Submit response' }).click();
        await expect(page.getByText('Enter your full name.')).toBeVisible();
      },
    ],
    ['last submission', (page) => openLink(page, 'closed')],
    ['outcome', (page) => openLink(page, 'sealed')],
    ['evidence requests', (page) => openLink(page, 'evidence')],
    [
      'error state',
      async (page) => {
        await openLink(page, 'unavailable');
        await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
      },
    ],
    [
      'no-permission state',
      async (page) => {
        await openLink(page, 'open');
        await expect(page.getByRole('heading', { level: 1, name: /Your response/ })).toBeVisible();
        await page.goto('/outcome');
        await expect(page.getByRole('heading', { name: 'You do not have access to this' })).toBeVisible();
      },
    ],
    ['page not found', (page) => page.goto('/quotes').then(() => undefined)],
  ];

  for (const [colorScheme, theme] of [
    ['dark', 'dark'],
    ['light', 'light'],
  ] as const) {
    for (const [name, open] of views) {
      test(`the ${name} has no axe violations in the ${theme} theme`, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await open(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('status').filter({ hasText: /^Loading|^Opening/ })).toHaveCount(0);
        await expectNoAxeViolations(page);
      });
    }
  }
});

test.describe('keyboard only', () => {
  test('a supplier opens the link, answers the last line and submits by keyboard alone', async ({ page }) => {
    await page.goto(linkUrl('open'));
    await tabTo(page, page.getByRole('button', { name: 'Continue' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: /Your response/ })).toBeVisible();
    await expect(page.getByRole('main')).toBeFocused();

    const answer = line(page, 4).getByRole('combobox', { name: 'Your answer' });
    await tabTo(page, answer);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: 'Quote', exact: true })).toBeVisible();
    // The first option is highlighted when the list opens.
    await page.keyboard.press('Enter');
    await expect(answer).toHaveText(/^Quote$/);

    const fields: readonly (readonly [string, string])[] = [
      ['Unit price at 2,000 pieces', '1.85'],
      ['Unit price at 5,000 pieces', '1.62'],
      ['Minimum order quantity', '1000'],
      ['Lead time in days', '28'],
      ['One-off costs', '0'],
    ];
    for (const [name, value] of fields) {
      await tabTo(page, line(page, 4).getByRole('textbox', { name }));
      await page.keyboard.type(value);
    }
    await page.keyboard.press('Tab');
    await expect(line(page, 4).getByLabel('Prices valid until')).toBeFocused();
    await page.keyboard.type('12312026');

    await tabTo(page, page.getByRole('textbox', { name: 'Your full name' }));
    await page.keyboard.type('Morgan Ellery');
    await tabTo(page, page.getByRole('checkbox', { name: /I am authorised/ }));
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: /I am authorised/ })).toBeChecked();
    await tabTo(page, page.getByRole('button', { name: 'Submit response' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: 'submitted in this preview' })).toBeFocused();
    await expect(page.getByText('3 of 3 lines answered')).toBeVisible();
  });

  test('the screens of a sealed request are reached through the skip link and navigation by keyboard', async ({
    page,
  }) => {
    await openLink(page, 'sealed');
    // The session outlives a reload, as the portal cookie will.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /Outcome/ })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await tabTo(page, page.getByRole('link', { name: 'Last submission' }));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: /Your last submission/ })).toBeVisible();
    await expect(page.getByRole('main')).toBeFocused();
  });
});
