import { describe, expect, it } from 'vitest';

import { gridRowHeight, rowItems, rowWindow, scrollTopRevealing, windowingThreshold } from './row-window';

describe('rendered row items', () => {
  it('renders every row without spacers when the window covers them all', () => {
    expect(rowItems({ start: 0, end: 3 }, 3, 1)).toEqual([
      { kind: 'row', index: 0 },
      { kind: 'row', index: 1 },
      { kind: 'row', index: 2 },
    ]);
  });

  it('keeps an active row below the window, with spacers standing in for the rows around it', () => {
    expect(rowItems({ start: 0, end: 2 }, 10, 6)).toEqual([
      { kind: 'row', index: 0 },
      { kind: 'row', index: 1 },
      { kind: 'spacer', firstIndex: 2, height: 4 * gridRowHeight },
      { kind: 'row', index: 6 },
      { kind: 'spacer', firstIndex: 7, height: 3 * gridRowHeight },
    ]);
  });

  it('keeps an active row above the window', () => {
    expect(rowItems({ start: 5, end: 7 }, 8, 1)).toEqual([
      { kind: 'spacer', firstIndex: 0, height: gridRowHeight },
      { kind: 'row', index: 1 },
      { kind: 'spacer', firstIndex: 2, height: 3 * gridRowHeight },
      { kind: 'row', index: 5 },
      { kind: 'row', index: 6 },
      { kind: 'spacer', firstIndex: 7, height: gridRowHeight },
    ]);
  });

  it('adds nothing for the header row or an active row inside the window', () => {
    expect(rowItems({ start: 2, end: 4 }, 5, null)).toEqual(rowItems({ start: 2, end: 4 }, 5, 3));
  });
});

describe('row windowing', () => {
  it('renders every row of a grid at the threshold', () => {
    expect(rowWindow({ rowCount: windowingThreshold, scrollTop: 5000, viewportHeight: 360 })).toEqual({
      start: 0,
      end: windowingThreshold,
    });
  });

  it('renders the rows in view plus overscan above the threshold', () => {
    const rendered = rowWindow({ rowCount: 5000, scrollTop: 100 * gridRowHeight, viewportHeight: 10 * gridRowHeight });
    expect(rendered).toEqual({ start: 90, end: 120 });
  });

  it('clamps the window to the first and last row', () => {
    expect(rowWindow({ rowCount: 5000, scrollTop: 0, viewportHeight: 360 })).toEqual({ start: 0, end: 20 });
    expect(rowWindow({ rowCount: 5000, scrollTop: 4995 * gridRowHeight, viewportHeight: 360 })).toEqual({
      start: 4985,
      end: 5000,
    });
  });

  it('scrolls down just far enough to show a row below the view', () => {
    const view = { scrollTop: 0, viewportHeight: 400, headerHeight: 40 };
    expect(scrollTopRevealing(20, view)).toBe(21 * gridRowHeight - 360);
  });

  it('scrolls up to a row above the view and leaves a visible row alone', () => {
    const view = { scrollTop: 50 * gridRowHeight, viewportHeight: 400, headerHeight: 40 };
    expect(scrollTopRevealing(10, view)).toBe(10 * gridRowHeight);
    expect(scrollTopRevealing(52, view)).toBe(50 * gridRowHeight);
  });
});
