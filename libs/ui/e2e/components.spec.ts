import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

import { themeNames, themes, type ThemeName } from '../src/tokens/themes.ts';

const storyIndexSchema = z.object({
  entries: z.record(z.string(), z.object({ id: z.string(), type: z.string(), tags: z.array(z.string()) })),
});

type StoryEntry = z.infer<typeof storyIndexSchema>['entries'][string];

// A story tagged `body-portal` opens a listbox or tooltip in a portal on <body>, outside every
// landmark by design; axe's best-practice `region` rule exempts dialogs but not these, so it is
// switched off for those stories only.
const bodyPortalTag = 'body-portal';

async function stories(page: Page): Promise<StoryEntry[]> {
  const response = await page.request.get('/index.json');
  const index = storyIndexSchema.parse(await response.json());
  return Object.values(index.entries).filter((entry) => entry.type === 'story');
}

async function openStory(page: Page, id: string, theme: ThemeName): Promise<void> {
  // The a11y addon's own axe run would collide with this one, so it is switched to manual.
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`);
  await expect(page.locator('body')).toHaveClass(/sb-show-main/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

function hex(rgb: string): string {
  const channels = rgb.match(/\d+/g)?.slice(0, 3) ?? [];
  return `#${channels.map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

for (const theme of themeNames) {
  test(`every component preview has no axe violations in the ${theme} theme`, async ({ page }) => {
    const entries = await stories(page);
    expect(entries.length).toBeGreaterThan(10);
    const violations: Record<string, string[]> = {};
    for (const entry of entries) {
      await test.step(entry.id, async () => {
        await openStory(page, entry.id, theme);
        const axe = new AxeBuilder({ page }).exclude('#storybook-docs');
        const results = await (entry.tags.includes(bodyPortalTag) ? axe.disableRules(['region']) : axe).analyze();
        if (results.violations.length > 0) {
          violations[entry.id] = results.violations.map(
            (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
          );
        }
      });
    }
    expect(violations).toEqual({});
  });

  test(`the preview paints the ${theme} theme's surface and text tokens`, async ({ page }) => {
    await openStory(page, 'components--buttons', theme);
    const main = page.getByRole('main');
    expect(hex(await main.evaluate((element) => getComputedStyle(element).backgroundColor))).toBe(
      themes[theme].surface,
    );
    expect(hex(await main.evaluate((element) => getComputedStyle(element).color))).toBe(themes[theme]['text-primary']);
  });
}

for (const [colorScheme, theme] of [
  ['light', 'light'],
  ['dark', 'dark'],
] as const) {
  test(`before a theme is set, a ${colorScheme}-scheme visitor sees the ${theme} surface`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openStory(page, 'components--buttons', 'dark');
    await page.evaluate(() => {
      delete document.documentElement.dataset['theme'];
    });
    const main = page.getByRole('main');
    expect(hex(await main.evaluate((element) => getComputedStyle(element).backgroundColor))).toBe(
      themes[theme].surface,
    );
  });
}

interface FocusedOutline {
  tag: string;
  style: string;
  width: string;
  colour: string;
}

async function focusedOutline(page: Page): Promise<FocusedOutline | null> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (focused === null) {
      return null;
    }
    const style = getComputedStyle(focused);
    return { tag: focused.tagName, style: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor };
  });
}

/** Tabs to the first control and returns screenshots of its surroundings before and after it takes focus. */
async function screenshotsAroundFocus(page: Page, control: Locator): Promise<[Buffer, Buffer]> {
  const box = await control.boundingBox();
  if (box === null) {
    throw new Error('The control is not visible');
  }
  const clip = { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 };
  const unfocused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  await page.keyboard.press('Tab');
  await expect(control).toBeFocused();
  const focused = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  return [unfocused, focused];
}

// Playwright's `forcedColors` context option does not reach the page in this version, so
// each test emulates the media feature on the page itself.
test.describe('in forced-colours mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  test('the page reports forced colours as active', async ({ page }) => {
    await openStory(page, 'components--buttons', 'dark');
    expect(await page.evaluate(() => matchMedia('(forced-colors: active)').matches)).toBe(true);
  });

  for (const theme of themeNames) {
    test(`a focused button keeps a visible focus indicator in the ${theme} theme`, async ({ page }) => {
      await openStory(page, 'components--buttons', theme);
      const button = page.getByRole('button').first();
      const [unfocused, focused] = await screenshotsAroundFocus(page, button);
      expect(await focusedOutline(page)).toMatchObject({ tag: 'BUTTON', style: 'solid', width: '2px' });
      expect(focused.equals(unfocused)).toBe(false);
    });

    test(`a focused input keeps a visible focus indicator in the ${theme} theme`, async ({ page }) => {
      await openStory(page, 'components--inputs', theme);
      const input = page.getByRole('textbox').first();
      const [unfocused, focused] = await screenshotsAroundFocus(page, input);
      expect(await focusedOutline(page)).toMatchObject({ tag: 'INPUT', style: 'solid', width: '2px' });
      expect(focused.equals(unfocused)).toBe(false);
    });
  }

  test('the selected tab keeps an underline that unselected tabs do not have', async ({ page }) => {
    await openStory(page, 'components--tabs-preview', 'dark');
    const colours = await page
      .getByRole('tab')
      .evaluateAll((tabs) => tabs.map((tab) => getComputedStyle(tab).borderBottomColor));
    const [selected, ...unselected] = colours;
    expect(unselected.length).toBeGreaterThan(0);
    for (const colour of unselected) {
      expect(colour).not.toBe(selected);
    }
  });

  test('an unfocused button draws no outline', async ({ page }) => {
    await openStory(page, 'components--buttons', 'dark');
    const button = page.getByRole('button').first();
    expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('none');
  });
});

test('a focused button shows the focus ring in normal colours', async ({ page }) => {
  await openStory(page, 'components--buttons', 'dark');
  await page.keyboard.press('Tab');
  const shadow = await page.evaluate(() =>
    document.activeElement === null ? '' : getComputedStyle(document.activeElement).boxShadow,
  );
  expect(shadow).toContain('rgb(3, 253, 252)');
});

test('the root error boundary shows the designed error state when a translation key is missing', async ({ page }) => {
  await openStory(page, 'states--root-error-boundary-catches-missing-key', 'dark');
  const alert = page.getByRole('alert');
  await expect(alert.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(alert).toContainText('This page stopped because of an unexpected error.');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('the error state fills its message params and offers a retry', async ({ page }) => {
  await openStory(page, 'states--error-with-retry', 'light');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('The supplier list could not be loaded (status 503).');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('the error state shows the generic message for a message key it does not know', async ({ page }) => {
  await openStory(page, 'states--error-with-unknown-key', 'dark');
  await expect(page.getByRole('alert')).toContainText('This page stopped because of an unexpected error.');
});

test('the empty state offers its next action', async ({ page }) => {
  await openStory(page, 'states--empty', 'dark');
  await expect(page.getByRole('heading', { name: 'No parts yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a parts list' })).toBeVisible();
});

test('the loading state announces itself politely', async ({ page }) => {
  await openStory(page, 'states--loading', 'dark');
  await expect(page.getByRole('status')).toHaveText('Loading parts…');
});

test('the no-permission state explains how to get access', async ({ page }) => {
  await openStory(page, 'states--no-permission', 'light');
  await expect(page.getByRole('heading', { name: 'You do not have access to this' })).toBeVisible();
  await expect(page.getByText('Ask your administrator for access to this page.')).toBeVisible();
});

test('the no-permission state tells supplier staff to ask the buyer who invited them', async ({ page }) => {
  await openStory(page, 'states--no-permission-for-supplier', 'dark');
  await expect(page.getByText('Ask the buyer who invited you for access to this page.')).toBeVisible();
});

test('a textarea inside a field gets its label, description and invalid state', async ({ page }) => {
  await openStory(page, 'components--inputs', 'dark');
  const notes = page.getByRole('textbox', { name: 'Notes for suppliers' });
  await expect(notes).toHaveAccessibleDescription(/Suppliers see these notes with the request for quotation\./);
  await expect(notes).toHaveAttribute('aria-invalid', 'true');
});

test('the root error boundary moves focus to its heading when it takes over', async ({ page }) => {
  await openStory(page, 'states--root-error-boundary-catches-missing-key', 'dark');
  await expect(page.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeFocused();
});

test('after a successful retry focus moves to the page the root error boundary rendered again', async ({ page }) => {
  await openStory(page, 'states--root-error-boundary-recovers', 'dark');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'The page rendered again after the retry.' })).toBeVisible();
  await expect(page.locator(':focus')).toContainText('The page rendered again after the retry.');
});

async function tabUntilFocused(page: Page, control: Locator): Promise<void> {
  for (let presses = 0; presses < 10; presses += 1) {
    if (await control.evaluate((element) => element === document.activeElement)) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(control).toBeFocused();
}

async function focusedBoxShadow(page: Page): Promise<string> {
  return page.evaluate(() =>
    document.activeElement === null ? '' : getComputedStyle(document.activeElement).boxShadow,
  );
}

test('the focus ring offset matches the raised surface of a card', async ({ page }) => {
  await openStory(page, 'components--display', 'dark');
  await tabUntilFocused(page, page.getByRole('button', { name: 'Copy part number' }));
  expect(await focusedBoxShadow(page)).toContain('rgb(18, 23, 27)');
});

test('the focus ring offset matches the overlay surface of a dialog', async ({ page }) => {
  await openStory(page, 'components--dialog-open', 'light');
  await tabUntilFocused(page, page.getByRole('button', { name: 'Cancel' }));
  expect(await focusedBoxShadow(page)).toContain('rgb(255, 255, 255)');
});
