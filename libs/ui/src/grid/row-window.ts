/** Grids with more body rows than this render only the rows in view (KTD28). */
export const windowingThreshold = 1000;

/** Every body row has this fixed height in pixels, so a windowed grid can place rows without measuring. */
export const gridRowHeight = 36;

/** Rows rendered beyond the viewport on each side, so short scrolls do not show blank space. */
const overscan = 10;

export interface RowWindow {
  /** First rendered body row, 0-based. */
  readonly start: number;
  /** One past the last rendered body row. */
  readonly end: number;
}

export interface RowWindowInput {
  readonly rowCount: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
}

/** Which body rows to render: all of them up to the threshold, otherwise the ones in view plus overscan. */
export function rowWindow({ rowCount, scrollTop, viewportHeight }: RowWindowInput): RowWindow {
  if (rowCount <= windowingThreshold) {
    return { start: 0, end: rowCount };
  }
  const firstVisible = Math.floor(Math.max(scrollTop, 0) / gridRowHeight);
  const visibleCount = Math.ceil(Math.max(viewportHeight, gridRowHeight) / gridRowHeight);
  const start = Math.min(Math.max(firstVisible - overscan, 0), rowCount);
  const end = Math.min(firstVisible + visibleCount + overscan, rowCount);
  return { start, end };
}

/**
 * The scroll position that brings a body row fully into view below the sticky header, or the current
 * one when the row is already in view.
 */
export function scrollTopRevealing(
  bodyRow: number,
  { scrollTop, viewportHeight, headerHeight }: { scrollTop: number; viewportHeight: number; headerHeight: number },
): number {
  const rowTop = bodyRow * gridRowHeight;
  const rowBottom = rowTop + gridRowHeight;
  const visibleBodyHeight = Math.max(viewportHeight - headerHeight, gridRowHeight);
  if (rowTop < scrollTop) {
    return rowTop;
  }
  if (rowBottom > scrollTop + visibleBodyHeight) {
    return rowBottom - visibleBodyHeight;
  }
  return scrollTop;
}
