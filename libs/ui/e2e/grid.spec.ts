import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

import { themeNames, type ThemeName } from '../src/tokens/themes.ts';

// Keyboard-only checks of the data grid (U26, KTD28). components.spec.ts also runs axe on the
// grid stories as first rendered; the checks here cover the states only the keyboard reaches.

async function openStory(page: Page, id: string, theme: ThemeName = 'dark'): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story&globals=theme:${theme};a11y.manual:!true`);
  await expect(page.locator('body')).toHaveClass(/sb-show-main/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await page.evaluate(() => document.fonts.ready);
}

function grid(page: Page): Locator {
  return page.getByRole('grid');
}

async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.textContent.trim() ?? '');
}

async function focusIsInGrid(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.closest('[role="grid"]') !== null);
}

/** Tabs into the parts grid, landing on the select-all checkbox in the first header cell. */
async function enterPartsGrid(page: Page): Promise<void> {
  await openStory(page, 'grid--parts');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Select all rows' })).toBeFocused();
}

test('tab enters the grid once and the next tab leaves it', async ({ page }) => {
  await enterPartsGrid(page);
  const tabStops = await grid(page).evaluate(
    (element) =>
      [...element.querySelectorAll<HTMLElement>('*')].filter((node) => node.tabIndex >= 0 && !node.hidden).length,
  );
  expect(tabStops).toBe(1);
  await page.keyboard.press('Tab');
  expect(await focusIsInGrid(page)).toBe(false);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('checkbox', { name: 'Select all rows' })).toBeFocused();
});

test('arrow keys move focus one cell at a time', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'Part number' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('rowheader', { name: 'PL-10001' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('checkbox', { name: 'Select PL-10001' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('checkbox', { name: 'Select PL-10008' })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await focusedText(page)).toBe('A');
});

test('Home and End jump to the first and last cell of the row', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  expect(await focusedText(page)).toBe('12.50');
  await page.keyboard.press('Home');
  await expect(page.getByRole('checkbox', { name: 'Select PL-10001' })).toBeFocused();
});

test('PageDown and PageUp move focus by a page of rows', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('PageDown');
  await expect(page.getByRole('rowheader', { name: 'PL-10071' })).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(page.getByRole('rowheader', { name: 'PL-10001' })).toBeFocused();
});

test('Control+End and Control+Home jump to the last and first cell of the grid', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('Control+End');
  expect(await focusIsInGrid(page)).toBe(true);
  const lastRow = grid(page).getByRole('row').last();
  await expect(lastRow.getByRole('rowheader')).toHaveText('PL-10274');
  expect(await page.evaluate(() => document.activeElement?.closest('tr')?.rowIndex)).toBe(40);
  await page.keyboard.press('Control+Home');
  await expect(page.getByRole('checkbox', { name: 'Select all rows' })).toBeFocused();
});

test('a sortable header exposes aria-sort and toggles it on Enter', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowRight');
  const header = page.getByRole('columnheader', { name: 'Part number' });
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  await expect(grid(page).getByRole('rowheader').first()).toHaveText('PL-10274');
  await expect(page.getByRole('button', { name: 'Part number' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(header).toHaveAttribute('aria-sort', 'none');
  await expect(grid(page).getByRole('rowheader').first()).toHaveText('PL-10001');
});

test('headers that cannot sort carry no aria-sort', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await expect(page.getByRole('columnheader').first()).not.toHaveAttribute('aria-sort');
});

test('an editable cell enters edit mode on Enter and returns to grid navigation on Escape', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowDown');
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('ArrowRight');
  }
  const cell = page.getByRole('gridcell', { name: '25', exact: true }).first();
  await expect(cell).toBeFocused();
  await expect(cell).toHaveAccessibleDescription('Press Enter to edit.');

  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Quantity PL-10001' });
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAccessibleDescription('Press Enter to save or Escape to cancel.');
  await page.keyboard.press('ArrowLeft');
  await expect(editor).toBeFocused();
  await page.keyboard.type('0');
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(cell).toBeFocused();
  await expect(cell).toHaveText('25');

  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-grid-cell'))).toBe('1:5');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('400');
  await page.keyboard.press('Enter');
  await expect(grid(page).getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('data-grid-cell'))).toBe('1:6');
  expect(await focusedText(page)).toBe('400');
});

test('a state badge names its state like its legend entry', async ({ page }) => {
  await openStory(page, 'grid--parts');
  const legend = page.getByRole('list', { name: 'Legend' });
  await expect(legend.getByRole('listitem')).toHaveText(['Approved', 'Pending review', 'Certificate expired', 'Draft']);
  const firstRow = grid(page).getByRole('row').nth(1);
  await expect(firstRow.getByRole('gridcell', { name: 'Approved', exact: true })).toBeVisible();
  const hiddenName = firstRow.locator('[data-state-badge="approved"] .sr-only');
  await expect(hiddenName).toHaveText('Approved');
  const box = await hiddenName.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(1);
  const badgeIcon = await firstRow.locator('[data-state-icon="approved"]').evaluate((icon) => icon.outerHTML);
  const legendIcon = await legend.locator('[data-state-icon="approved"]').evaluate((icon) => icon.outerHTML);
  expect(badgeIcon).toBe(legendIcon);
});

test('a row checkbox takes a click within its 24-pixel hit area', async ({ page }) => {
  await openStory(page, 'grid--parts');
  const checkbox = page.getByRole('checkbox', { name: 'Select PL-10001' });
  const box = await checkbox.boundingBox();
  if (box === null) {
    throw new Error('The checkbox is not visible');
  }
  expect(box.width).toBe(16);
  await page.mouse.click(box.x + box.width + 3, box.y + box.height + 3);
  await expect(checkbox).toBeChecked();
  await expect(grid(page).getByRole('row').nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('status')).toHaveText('1 selected');
});

test('space on a row checkbox selects the row', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'Select PL-10001' })).toBeChecked();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText('40 selected');
});

test('the header stays in view and focus stays clear of it while the body scrolls', async ({ page }) => {
  await enterPartsGrid(page);
  await page.keyboard.press('ArrowRight');
  for (let presses = 0; presses < 20; presses += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect(page.getByRole('rowheader', { name: 'PL-10134' })).toBeFocused();
  const header = page.getByRole('columnheader', { name: 'Part number' });
  const headerBox = await header.boundingBox();
  const containerBox = await grid(page).locator('..').boundingBox();
  const focusedBox = await page.getByRole('rowheader', { name: 'PL-10134' }).boundingBox();
  if (headerBox === null || containerBox === null || focusedBox === null) {
    throw new Error('The grid is not visible');
  }
  expect(
    await grid(page)
      .locator('..')
      .evaluate((container) => container.scrollTop),
  ).toBeGreaterThan(0);
  expect(Math.abs(headerBox.y - containerBox.y)).toBeLessThanOrEqual(1);
  expect(focusedBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
});

test('the header row and the first column are sticky', async ({ page }) => {
  await openStory(page, 'grid--parts');
  const positions = await grid(page).evaluate((element) => ({
    header: getComputedStyle(element.querySelectorAll('thead th')[3] ?? element).position,
    rowHeader: getComputedStyle(element.querySelector('tbody th') ?? element).position,
    rowHeaderLeft: getComputedStyle(element.querySelector('tbody th') ?? element).left,
    checkboxCell: getComputedStyle(element.querySelector('tbody td') ?? element).position,
  }));
  expect(positions).toEqual({ header: 'sticky', rowHeader: 'sticky', rowHeaderLeft: '40px', checkboxCell: 'sticky' });
});

test('a grid under 1,000 rows renders every row without aria-rowcount', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await expect(grid(page)).not.toHaveAttribute('aria-rowcount');
  await expect(grid(page).getByRole('row')).toHaveCount(41);
});

test('a grid over 1,000 rows renders a window of rows with aria-rowcount and aria-rowindex', async ({ page }) => {
  await openStory(page, 'grid--large-catalogue');
  await expect(grid(page)).toHaveAttribute('aria-rowcount', '5001');
  const rendered = await grid(page).getByRole('row').count();
  expect(rendered).toBeLessThan(100);
  await expect(grid(page).getByRole('row').first()).toHaveAttribute('aria-rowindex', '1');
  await expect(grid(page).getByRole('row').nth(1)).toHaveAttribute('aria-rowindex', '2');

  await page.keyboard.press('Tab');
  await page.keyboard.press('Control+End');
  const lastRow = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'PL-44994' }) });
  await expect(lastRow).toHaveAttribute('aria-rowindex', '5001');
  expect(await page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex'))).toBe('5001');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(100);

  await page.keyboard.press('PageUp');
  expect(await page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex'))).toBe('4991');
  await page.keyboard.press('Control+Home');
  await expect(page.getByRole('button', { name: 'Part number' })).toBeFocused();
});

const focusRingColours: Record<ThemeName, string> = { dark: 'rgb(3, 253, 252)', light: 'rgb(0, 106, 115)' };

for (const theme of themeNames) {
  test(`a focused cell shows the focus ring in the ${theme} theme`, async ({ page }) => {
    await openStory(page, 'grid--parts', theme);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const cell = page.getByRole('rowheader', { name: 'PL-10001' });
    await expect(cell).toBeFocused();
    expect(await cell.evaluate((element) => getComputedStyle(element).boxShadow)).toContain(focusRingColours[theme]);
  });
}

test.describe('in forced-colours mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
  });

  for (const theme of themeNames) {
    test(`a focused cell keeps a visible outline in the ${theme} theme`, async ({ page }) => {
      await openStory(page, 'grid--parts', theme);
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowDown');
      const cell = page.getByRole('rowheader', { name: 'PL-10001' });
      const box = await cell.boundingBox();
      if (box === null) {
        throw new Error('The cell is not visible');
      }
      const unfocused = await page.screenshot({ clip: box, animations: 'disabled', caret: 'hide' });
      await page.keyboard.press('ArrowRight');
      await expect(cell).toBeFocused();
      const focused = await page.screenshot({ clip: box, animations: 'disabled', caret: 'hide' });
      const outline = await cell.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
      });
      expect(outline).toEqual({ style: 'solid', width: '2px', offset: '-2px' });
      expect(focused.equals(unfocused)).toBe(false);
    });

    test(`a focused sort button keeps a visible outline in the ${theme} theme`, async ({ page }) => {
      await openStory(page, 'grid--parts', theme);
      await page.keyboard.press('Tab');
      await page.keyboard.press('ArrowRight');
      const button = page.getByRole('button', { name: 'Part number' });
      await expect(button).toBeFocused();
      expect(await button.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    });
  }
});

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).exclude('#storybook-docs').analyze();
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`,
  );
}

for (const theme of themeNames) {
  test(`axe finds no violations in a sorted grid with a selected row and an open editor in the ${theme} theme`, async ({
    page,
  }) => {
    await openStory(page, 'grid--parts', theme);
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Space');
    for (let presses = 0; presses < 6; presses += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Enter');
    await expect(grid(page).getByRole('textbox')).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`axe finds no violations in a windowed grid scrolled to its end in the ${theme} theme`, async ({ page }) => {
    await openStory(page, 'grid--large-catalogue', theme);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Control+End');
    await expect(page.getByRole('rowheader', { name: 'PL-44994' })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });

  test(`axe finds no violations with a refused edit showing its message in the ${theme} theme`, async ({ page }) => {
    await openStory(page, 'grid--parts', theme);
    await openFirstQuantityEditor(page);
    await page.keyboard.type('abc');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
}

async function focusedCellPosition(page: Page): Promise<string | null> {
  return page.evaluate(
    () => document.activeElement?.closest('[data-grid-cell]')?.getAttribute('data-grid-cell') ?? null,
  );
}

/** From a freshly opened parts story, opens the editor on the first row's quantity with its text selected. */
async function openFirstQuantityEditor(page: Page): Promise<Locator> {
  await page.keyboard.press('Tab');
  await page.keyboard.press('ArrowDown');
  for (let presses = 0; presses < 6; presses += 1) {
    await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Enter');
  const editor = page.getByRole('textbox', { name: 'Quantity PL-10001' });
  await expect(editor).toBeFocused();
  await page.keyboard.press('Control+A');
  return editor;
}

test('tab out of an open editor commits the edit once and leaves the grid in one press', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await openFirstQuantityEditor(page);
  await page.keyboard.type('400');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'Notes for suppliers' })).toBeFocused();
  await expect(page.getByText('1 edits saved')).toBeVisible();
  await expect(grid(page).locator('[data-grid-cell="1:6"]')).toHaveText('400');
  await page.keyboard.press('Shift+Tab');
  expect(await focusedCellPosition(page)).toBe('1:6');
});

test('shift-tab out of an open editor commits the edit and leaves the grid backwards', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await openFirstQuantityEditor(page);
  await page.keyboard.type('125');
  await page.keyboard.press('Shift+Tab');
  expect(await focusIsInGrid(page)).toBe(false);
  await expect(page.getByText('1 edits saved')).toBeVisible();
  await expect(grid(page).locator('[data-grid-cell="1:6"]')).toHaveText('125');
});

test('clicking an input outside the grid keeps focus there and commits the edit once', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await openFirstQuantityEditor(page);
  await page.keyboard.type('75');
  const notes = page.getByRole('textbox', { name: 'Notes for suppliers' });
  await notes.click();
  await expect(notes).toBeFocused();
  await expect(page.getByText('1 edits saved')).toBeVisible();
  await expect(grid(page).locator('[data-grid-cell="1:6"]')).toHaveText('75');
  await page.keyboard.type('x');
  await expect(notes).toHaveValue('x');
});

test('a refused edit keeps the editor open, marked invalid, with its message announced', async ({ page }) => {
  await openStory(page, 'grid--parts');
  const editor = await openFirstQuantityEditor(page);
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await expect(editor).toBeFocused();
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(editor).toHaveAccessibleDescription(/Enter a whole number greater than zero\./);
  await expect(page.getByRole('alert')).toHaveText('Enter a whole number greater than zero.');
  await expect(page.getByText('0 edits saved')).toBeVisible();

  await page.keyboard.press('Control+A');
  await page.keyboard.type('30');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await focusedCellPosition(page)).toBe('1:6');
  expect(await focusedText(page)).toBe('30');
  await expect(page.getByText('1 edits saved')).toBeVisible();
});

test('focus follows the edited row when the edit moves it in a sorted grid', async ({ page }) => {
  await openStory(page, 'grid--parts');
  await page.getByRole('button', { name: 'Quantity' }).click();
  await expect(page.getByRole('columnheader', { name: 'Quantity' })).toHaveAttribute('aria-sort', 'ascending');
  await expect(grid(page).getByRole('rowheader').first()).toHaveText('PL-10001');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Quantity PL-10001' })).toBeFocused();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('99999');
  await page.keyboard.press('Enter');
  await expect(grid(page).getByRole('rowheader').last()).toHaveText('PL-10001');
  expect(await focusedCellPosition(page)).toBe('40:6');
  expect(await focusedText(page)).toBe('99999');
  expect(await page.evaluate(() => document.activeElement?.closest('tr')?.querySelector('th')?.textContent)).toBe(
    'PL-10001',
  );
});

test('a focused row in a windowed grid survives being scrolled far away', async ({ page }) => {
  await openStory(page, 'grid--large-catalogue');
  await page.keyboard.press('Tab');
  for (let presses = 0; presses < 3; presses += 1) {
    await page.keyboard.press('ArrowDown');
  }
  const focusedRowIndex = () =>
    page.evaluate(() => document.activeElement?.closest('tr')?.getAttribute('aria-rowindex') ?? null);
  expect(await focusedRowIndex()).toBe('4');

  const container = grid(page).locator('..');
  const box = await container.boundingBox();
  if (box === null) {
    throw new Error('The grid is not visible');
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => container.evaluate((element) => element.scrollTop)).toBeGreaterThan(4000);
  expect(await focusedRowIndex()).toBe('4');

  await container.evaluate((element) => {
    element.scrollTop = 150_000;
  });
  await expect.poll(() => grid(page).getByRole('rowheader', { name: 'PL-10015' }).count()).toBe(1);
  expect(await focusedRowIndex()).toBe('4');
  expect(await grid(page).getByRole('row').count()).toBeLessThan(100);

  await page.keyboard.press('ArrowDown');
  expect(await focusedRowIndex()).toBe('5');
  await expect(page.getByRole('button', { name: 'Part number' })).not.toBeFocused();
  expect(await focusIsInGrid(page)).toBe(true);
});

interface IconPaint {
  readonly icon: string;
  readonly colour: string;
  readonly background: string;
  readonly opacity: number;
}

function channels(colour: string): [number, number, number, number] {
  const values = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 1];
}

function luminance([red, green, blue]: readonly number[]): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red ?? 0) + 0.7152 * linear(green ?? 0) + 0.0722 * linear(blue ?? 0);
}

/** The contrast an icon actually shows, with its colour's alpha and every opacity down to its background applied. */
function paintedContrast({ colour, background, opacity }: IconPaint): number {
  const [red, green, blue, alpha] = channels(colour);
  const [backRed, backGreen, backBlue] = channels(background);
  const weight = alpha * opacity;
  const painted = [red, green, blue].map((channel, index) => {
    const back = [backRed, backGreen, backBlue][index] ?? 0;
    return channel * weight + back * (1 - weight);
  });
  const lighter = Math.max(luminance(painted), luminance([backRed, backGreen, backBlue]));
  const darker = Math.min(luminance(painted), luminance([backRed, backGreen, backBlue]));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of themeNames) {
  test(`every icon in the grid keeps 3:1 against its background in the ${theme} theme`, async ({ page }) => {
    await openStory(page, 'grid--parts', theme);
    await page.getByRole('checkbox', { name: 'Select PL-10001' }).click();
    await page.getByRole('button', { name: 'Revision' }).click();
    const paints = await grid(page).evaluate((element): IconPaint[] =>
      [...element.querySelectorAll('svg')]
        .filter((icon) => icon.getBoundingClientRect().width > 0)
        .map((icon) => {
          let opacity = 1;
          let background = 'rgba(0, 0, 0, 0)';
          let node: Element | null = icon;
          while (node !== null) {
            const style = getComputedStyle(node);
            opacity *= Number(style.opacity);
            const fill = style.backgroundColor;
            if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') {
              background = fill;
              break;
            }
            node = node.parentElement;
          }
          const cell = icon.closest('[data-grid-cell]')?.getAttribute('data-grid-cell') ?? '';
          return {
            icon: `${cell} ${icon.getAttribute('class') ?? ''}`,
            colour: getComputedStyle(icon).color,
            background,
            opacity,
          };
        }),
    );
    expect(paints.some((paint) => paint.icon.includes('lucide-arrow-up-down'))).toBe(true);
    const failing = paints
      .map((paint) => ({ icon: paint.icon, contrast: Math.round(paintedContrast(paint) * 100) / 100 }))
      .filter((paint) => paint.contrast < 3);
    expect(failing).toEqual([]);
  });
}
