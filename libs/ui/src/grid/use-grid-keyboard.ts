import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';

/** A cell in the grid; row 0 is the header row, rows 1 to `rowCount - 1` are body rows. */
export interface GridPosition {
  readonly row: number;
  readonly column: number;
}

export interface GridBounds {
  /** Header row included. */
  readonly rowCount: number;
  readonly columnCount: number;
  /** How many rows PageUp and PageDown move. */
  readonly pageSize: number;
}

export interface GridKey {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.min(Math.max(value, lowest), highest);
}

/**
 * Where focus goes for a navigation key under the ARIA APG grid pattern, or `null` when the key does
 * not navigate. Focus never wraps between rows, and PageUp/PageDown stop at the first and last row.
 */
export function nextGridPosition(position: GridPosition, key: GridKey, bounds: GridBounds): GridPosition | null {
  const lastRow = bounds.rowCount - 1;
  const lastColumn = bounds.columnCount - 1;
  const control = key.ctrlKey || key.metaKey;
  const { row, column } = position;
  switch (key.key) {
    case 'ArrowRight':
      return { row, column: clamp(column + 1, 0, lastColumn) };
    case 'ArrowLeft':
      return { row, column: clamp(column - 1, 0, lastColumn) };
    case 'ArrowDown':
      return { row: clamp(row + 1, 0, lastRow), column };
    case 'ArrowUp':
      return { row: clamp(row - 1, 0, lastRow), column };
    case 'Home':
      return control ? { row: 0, column: 0 } : { row, column: 0 };
    case 'End':
      return control ? { row: lastRow, column: lastColumn } : { row, column: lastColumn };
    case 'PageDown':
      return { row: clamp(row + bounds.pageSize, 0, lastRow), column };
    case 'PageUp':
      return { row: clamp(row - bounds.pageSize, 0, lastRow), column };
    default:
      return null;
  }
}

/** Keeps a remembered position inside the grid after rows or columns disappear. */
export function clampGridPosition(position: GridPosition, bounds: Omit<GridBounds, 'pageSize'>): GridPosition {
  return {
    row: clamp(position.row, 0, Math.max(bounds.rowCount - 1, 0)),
    column: clamp(position.column, 0, Math.max(bounds.columnCount - 1, 0)),
  };
}

// A cell holding one of these moves focus to it instead of to the cell itself (APG grid pattern).
const widgetSelector = [
  'a[href]',
  'button',
  'input:not([type="hidden"]):not([aria-hidden="true"])',
  'select',
  'textarea',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="button"]',
].join(', ');

export const gridCellAttribute = 'data-grid-cell';

function cellSelector(position: GridPosition): string {
  return `[${gridCellAttribute}="${position.row}:${position.column}"]`;
}

/** The element that takes focus for a cell: its widget if it has one, the cell otherwise. */
export function focusTarget(cell: HTMLElement): HTMLElement {
  const widget = cell.querySelector<HTMLElement>(widgetSelector);
  return widget ?? cell;
}

/** Reads `row:column` from a cell's data attribute. */
export function parseCellPosition(value: string | null): GridPosition | null {
  const match = /^(\d+):(\d+)$/.exec(value ?? '');
  if (match === null) {
    return null;
  }
  return { row: Number(match[1]), column: Number(match[2]) };
}

/** One tab stop: the active cell's focus target gets tabindex 0, every other cell and widget -1. */
function syncTabStops(grid: HTMLElement, active: GridPosition): void {
  for (const cell of grid.querySelectorAll<HTMLElement>(`[${gridCellAttribute}]`)) {
    const isActive = cell.matches(cellSelector(active));
    const widgets = cell.querySelectorAll<HTMLElement>(widgetSelector);
    for (const widget of widgets) {
      widget.tabIndex = -1;
    }
    const target = widgets[0] ?? cell;
    if (target === cell) {
      cell.tabIndex = isActive ? 0 : -1;
    } else {
      cell.removeAttribute('tabindex');
      target.tabIndex = isActive ? 0 : -1;
    }
  }
  // When the active row is not rendered (a windowed grid scrolled away), the first rendered cell keeps
  // the grid reachable by Tab.
  if (grid.querySelector(cellSelector(active)) === null) {
    const first = grid.querySelector<HTMLElement>(`[${gridCellAttribute}]`);
    if (first !== null) {
      focusTarget(first).tabIndex = 0;
    }
  }
}

/** The header row has no row key; body rows are keyed by their row id. */
export type GridRowKey = string | null;

/** The active cell, remembered by row key so it follows its row when sorting or edits reorder the rows. */
export interface ActiveCell {
  readonly rowKey: GridRowKey;
  readonly column: number;
  /** Where the row last was, used when the row itself disappears. */
  readonly lastRow: number;
}

/** Maps a remembered active cell onto the current rows. */
export function resolveActiveCell(
  active: ActiveCell,
  bodyRowKeys: readonly string[],
  columnCount: number,
): GridPosition {
  const bodyIndex = active.rowKey === null ? -1 : bodyRowKeys.indexOf(active.rowKey);
  const row = active.rowKey === null ? 0 : bodyIndex >= 0 ? bodyIndex + 1 : active.lastRow;
  return clampGridPosition({ row, column: active.column }, { rowCount: bodyRowKeys.length + 1, columnCount });
}

export interface GridKeyboardOptions {
  /** Row ids of the body rows in display order. */
  readonly bodyRowKeys: readonly string[];
  readonly columnCount: number;
  /** How many rows PageUp and PageDown move. */
  readonly pageSize: number;
  /** While a cell is being edited its editor owns the keyboard, so the grid ignores keys. */
  readonly isEditing: boolean;
  /** Called for Enter or F2 on a cell (not on a widget inside it). Returns true when it handled the key. */
  readonly onActivateCell: (position: GridPosition) => boolean;
  /** Called before focus moves to a position, so a windowed grid can scroll to the row. */
  readonly onBeforeMove?: ((position: GridPosition) => void) | undefined;
}

export interface GridKeyboard {
  readonly gridRef: RefObject<HTMLTableElement | null>;
  readonly active: GridPosition;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  /** Moves the active cell and focuses it after the next render. */
  readonly focusCell: (position: GridPosition) => void;
  /** Focuses a cell of the row with this key, wherever that row is after the next render. */
  readonly focusRow: (rowKey: GridRowKey, column: number) => void;
}

/** Roving-tabindex keyboard navigation for an ARIA grid (APG grid pattern, KTD28). */
export function useGridKeyboard({
  bodyRowKeys,
  columnCount,
  pageSize,
  isEditing,
  onActivateCell,
  onBeforeMove,
}: GridKeyboardOptions): GridKeyboard {
  const gridRef = useRef<HTMLTableElement>(null);
  const [storedActive, setActive] = useState<ActiveCell>({ rowKey: null, column: 0, lastRow: 0 });
  const focusPending = useRef(false);
  const active = resolveActiveCell(storedActive, bodyRowKeys, columnCount);
  const bounds: GridBounds = { rowCount: bodyRowKeys.length + 1, columnCount, pageSize };

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (grid === null) {
      return;
    }
    syncTabStops(grid, active);
    if (focusPending.current) {
      const cell = grid.querySelector<HTMLElement>(cellSelector(active));
      if (cell !== null) {
        focusPending.current = false;
        focusTarget(cell).focus();
      }
    }
  });

  const rowKeyAt = useCallback(
    (row: number): GridRowKey => (row === 0 ? null : (bodyRowKeys[row - 1] ?? null)),
    [bodyRowKeys],
  );

  const focusRow = useCallback((rowKey: GridRowKey, column: number) => {
    focusPending.current = true;
    setActive((current) => ({ rowKey, column, lastRow: current.lastRow }));
  }, []);

  const focusCell = useCallback(
    (position: GridPosition) => {
      onBeforeMove?.(position);
      focusPending.current = true;
      setActive({ rowKey: rowKeyAt(position.row), column: position.column, lastRow: position.row });
    },
    [onBeforeMove, rowKeyAt],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (isEditing || event.altKey) {
      return;
    }
    const next = nextGridPosition(active, event, bounds);
    if (next !== null) {
      event.preventDefault();
      focusCell(next);
      return;
    }
    const onCell = event.target instanceof HTMLElement && event.target.hasAttribute(gridCellAttribute);
    if ((event.key === 'Enter' || event.key === 'F2') && onCell && onActivateCell(active)) {
      event.preventDefault();
    }
  };

  const onFocus = (event: FocusEvent<HTMLElement>) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }
    const cell = event.target.closest(`[${gridCellAttribute}]`);
    const position = parseCellPosition(cell?.getAttribute(gridCellAttribute) ?? null);
    if (position !== null) {
      const rowKey = rowKeyAt(position.row);
      setActive((current) =>
        current.rowKey === rowKey && current.column === position.column
          ? current
          : { rowKey, column: position.column, lastRow: position.row },
      );
    }
  };

  return { gridRef, active, onKeyDown, onFocus, focusCell, focusRow };
}
