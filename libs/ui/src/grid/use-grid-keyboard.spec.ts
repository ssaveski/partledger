import { describe, expect, it } from 'vitest';

import {
  clampGridPosition,
  nextGridPosition,
  parseCellPosition,
  resolveActiveCell,
  type GridKey,
} from './use-grid-keyboard';

const bounds = { rowCount: 41, columnCount: 8, pageSize: 10 };

function press(key: string, modifiers: Partial<Omit<GridKey, 'key'>> = {}): GridKey {
  return { key, ctrlKey: false, metaKey: false, ...modifiers };
}

describe('grid keyboard navigation', () => {
  it('moves one cell for each arrow key', () => {
    const start = { row: 5, column: 3 };
    expect(nextGridPosition(start, press('ArrowRight'), bounds)).toEqual({ row: 5, column: 4 });
    expect(nextGridPosition(start, press('ArrowLeft'), bounds)).toEqual({ row: 5, column: 2 });
    expect(nextGridPosition(start, press('ArrowDown'), bounds)).toEqual({ row: 6, column: 3 });
    expect(nextGridPosition(start, press('ArrowUp'), bounds)).toEqual({ row: 4, column: 3 });
  });

  it('stays on the edge cell instead of wrapping', () => {
    expect(nextGridPosition({ row: 0, column: 0 }, press('ArrowUp'), bounds)).toEqual({ row: 0, column: 0 });
    expect(nextGridPosition({ row: 0, column: 0 }, press('ArrowLeft'), bounds)).toEqual({ row: 0, column: 0 });
    expect(nextGridPosition({ row: 40, column: 7 }, press('ArrowDown'), bounds)).toEqual({ row: 40, column: 7 });
    expect(nextGridPosition({ row: 40, column: 7 }, press('ArrowRight'), bounds)).toEqual({ row: 40, column: 7 });
  });

  it('jumps within the row on Home and End', () => {
    expect(nextGridPosition({ row: 12, column: 4 }, press('Home'), bounds)).toEqual({ row: 12, column: 0 });
    expect(nextGridPosition({ row: 12, column: 4 }, press('End'), bounds)).toEqual({ row: 12, column: 7 });
  });

  it('jumps to the first and last cell of the grid with Control or Command held', () => {
    expect(nextGridPosition({ row: 12, column: 4 }, press('Home', { ctrlKey: true }), bounds)).toEqual({
      row: 0,
      column: 0,
    });
    expect(nextGridPosition({ row: 12, column: 4 }, press('End', { ctrlKey: true }), bounds)).toEqual({
      row: 40,
      column: 7,
    });
    expect(nextGridPosition({ row: 12, column: 4 }, press('End', { metaKey: true }), bounds)).toEqual({
      row: 40,
      column: 7,
    });
  });

  it('moves a page of rows on PageDown and PageUp and stops at the first and last row', () => {
    expect(nextGridPosition({ row: 1, column: 2 }, press('PageDown'), bounds)).toEqual({ row: 11, column: 2 });
    expect(nextGridPosition({ row: 35, column: 2 }, press('PageDown'), bounds)).toEqual({ row: 40, column: 2 });
    expect(nextGridPosition({ row: 11, column: 2 }, press('PageUp'), bounds)).toEqual({ row: 1, column: 2 });
    expect(nextGridPosition({ row: 4, column: 2 }, press('PageUp'), bounds)).toEqual({ row: 0, column: 2 });
  });

  it('ignores keys that do not navigate', () => {
    expect(nextGridPosition({ row: 1, column: 1 }, press('Enter'), bounds)).toBeNull();
    expect(nextGridPosition({ row: 1, column: 1 }, press('a'), bounds)).toBeNull();
    expect(nextGridPosition({ row: 1, column: 1 }, press('Tab'), bounds)).toBeNull();
  });

  it('keeps a remembered cell inside a grid that lost rows or columns', () => {
    expect(clampGridPosition({ row: 30, column: 6 }, { rowCount: 5, columnCount: 3 })).toEqual({ row: 4, column: 2 });
    expect(clampGridPosition({ row: 3, column: 1 }, { rowCount: 5, columnCount: 3 })).toEqual({ row: 3, column: 1 });
    expect(clampGridPosition({ row: 3, column: 1 }, { rowCount: 0, columnCount: 0 })).toEqual({ row: 0, column: 0 });
  });

  it('finds the active row by its key after the rows reorder', () => {
    const active = { rowKey: 'part-1', column: 2, lastRow: 1 };
    expect(resolveActiveCell(active, ['part-2', 'part-3', 'part-1'], 4)).toEqual({ row: 3, column: 2 });
    expect(resolveActiveCell({ rowKey: null, column: 1, lastRow: 0 }, ['part-1'], 4)).toEqual({ row: 0, column: 1 });
  });

  it('falls back to where the active row was when that row is gone', () => {
    const active = { rowKey: 'part-9', column: 2, lastRow: 2 };
    expect(resolveActiveCell(active, ['part-1', 'part-2', 'part-3'], 4)).toEqual({ row: 2, column: 2 });
    expect(resolveActiveCell(active, ['part-1'], 4)).toEqual({ row: 1, column: 2 });
  });

  it('reads a cell position from its data attribute and rejects anything else', () => {
    expect(parseCellPosition('12:3')).toEqual({ row: 12, column: 3 });
    expect(parseCellPosition('12')).toBeNull();
    expect(parseCellPosition('-1:3')).toBeNull();
    expect(parseCellPosition(null)).toBeNull();
  });
});
