import { describe, expect, it } from 'vitest';

import { gridRowHeight, rowWindow, scrollTopRevealing, windowingThreshold } from './row-window';

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
