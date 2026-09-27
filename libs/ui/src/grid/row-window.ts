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

export type RowItem =
  | { readonly kind: 'row'; readonly index: number }
  | { readonly kind: 'spacer'; readonly firstIndex: number; readonly height: number };

/**
 * The body rows to render in order, with spacers standing in for the rows left out. The active row is
 * always included, so a focused row survives being scrolled out of the window.
 */
export function rowItems(rendered: RowWindow, rowCount: number, activeRow: number | null): RowItem[] {
  const indexes: number[] = [];
  for (let index = rendered.start; index < rendered.end; index += 1) {
    indexes.push(index);
  }
  const activeOutside =
    activeRow !== null &&
    activeRow >= 0 &&
    activeRow < rowCount &&
    (activeRow < rendered.start || activeRow >= rendered.end);
  if (activeOutside) {
    indexes.push(activeRow);
    indexes.sort((first, second) => first - second);
  }
  const items: RowItem[] = [];
  let next = 0;
  for (const index of indexes) {
    if (index > next) {
      items.push({ kind: 'spacer', firstIndex: next, height: (index - next) * gridRowHeight });
    }
    items.push({ kind: 'row', index });
    next = index + 1;
  }
  if (next < rowCount) {
    items.push({ kind: 'spacer', firstIndex: next, height: (rowCount - next) * gridRowHeight });
  }
  return items;
}
