import type { MessageParams } from '@partledger/contracts';
import {
  createColumnHelper,
  createSortedRowModel,
  metaHelper,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnHelper,
  type Row,
  type RowData,
  type TableOptions,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Checkbox } from '../components/checkbox';
import { Input } from '../components/input';
import { useTranslate } from '../i18n/translation';
import { cn, focusRing, raisedSurface } from '../lib/cn';
import { gridRowHeight, rowItems, rowWindow, scrollTopRevealing, windowingThreshold } from './row-window';
import { gridCellAttribute, useGridKeyboard, type GridPosition } from './use-grid-keyboard';

/** Per-column options the grid reads from `meta`. */
export interface GridColumnMeta {
  /** Enter, F2 or a double click opens an editor for the cell's value; the grid reports it through `onCellEdit`. */
  editable?: boolean;
  /** Right-aligned monospaced figures, for identifiers, prices and quantities. */
  numeric?: boolean;
}

/** The TanStack Table v9 features every grid declares (KTD27): sorting and row selection. */
export const gridFeatures = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, datetime: sortFn_datetime, basic: sortFn_basic },
  columnMeta: metaHelper<GridColumnMeta>(),
});

export type GridFeatures = typeof gridFeatures;

export type GridColumns<TData extends RowData> = TableOptions<GridFeatures, TData>['columns'];

/** Column definitions for a grid; the first column becomes the pinned row header. */
export function createGridColumnHelper<TData extends RowData>(): ColumnHelper<GridFeatures, TData> {
  return createColumnHelper<GridFeatures, TData>();
}

export interface GridCellEdit {
  readonly rowId: string;
  readonly columnId: string;
  readonly value: string;
}

/** Whether an edit was accepted; a refusal names a message key the editor shows while it stays open. */
export type GridEditResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly messageKey: string; readonly params?: MessageParams | undefined };

type GridEditRejection = Extract<GridEditResult, { ok: false }>;

export interface DataGridProps<TData extends RowData> {
  /** The grid's accessible name, already translated. */
  label: string;
  data: TableOptions<GridFeatures, TData>['data'];
  /** Data columns, without grouped headers. Cells render text, state badges and at most one widget each. */
  columns: GridColumns<TData>;
  getRowId: (row: TData) => string;
  /** Adds a checkbox column for selecting rows. */
  selectable?: boolean;
  onSelectionChange?: (selectedRowIds: readonly string[]) => void;
  /** Validates and stores an edit; the editor closes only when the result is `ok`. */
  onCellEdit?: (edit: GridCellEdit) => GridEditResult | Promise<GridEditResult>;
  /** Rows that PageUp and PageDown move; default 10. */
  pageSize?: number;
  /** Size the scroll container, for example `max-h-96`; the header stays in view while the body scrolls. */
  className?: string;
}

const selectColumnId = 'pl-select';

// By the row's position in `data`, not its id, so an id with a space cannot break an id reference.
function rowHeaderElementId(gridId: string, row: { index: number }): string {
  return `${gridId}-row-${row.index}`;
}

function selectLabelElementId(gridId: string): string {
  return `${gridId}-select`;
}

const cellClasses = cn(
  'h-9 border-b border-line px-3 text-left align-middle whitespace-nowrap',
  'group-aria-selected:bg-surface-sunken',
  // The ring sits inside the cell, so sticky neighbours and the scroll edge cannot cover it; in forced
  // colours `outline-hidden` becomes a system-coloured outline, drawn inside for the same reason.
  'focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
  'forced-colors:focus-visible:-outline-offset-2',
);

const pinnedClasses = 'sticky z-10 bg-surface-raised';

const headerClasses =
  'sticky top-0 z-20 bg-surface-sunken font-medium text-muted [--pl-ring-offset:var(--pl-surface-sunken)]';

// WCAG 2.5.8: the 16px checkbox takes clicks across 24px; the inset counts from inside its 1px border.
const checkboxHitArea = 'relative after:absolute after:-inset-[5px]';

const ariaSortValues = { asc: 'ascending', desc: 'descending' } as const;

function SortIcon({ direction }: { direction: false | 'asc' | 'desc' }) {
  const Icon = direction === 'asc' ? ArrowUpIcon : direction === 'desc' ? ArrowDownIcon : ArrowUpDownIcon;
  // No opacity: the icon keeps the header's text colour, whose contrast `pnpm contrast:check` covers.
  return <Icon aria-hidden className="size-3.5 shrink-0" />;
}

function translateOrNull(format: () => string): string | null {
  try {
    return format();
  } catch {
    return null;
  }
}

function CellEditor({
  initialValue,
  labelledBy,
  hintId,
  errorId,
  save,
  close,
}: {
  initialValue: string;
  labelledBy: string;
  hintId: string;
  errorId: string;
  save: (value: string) => GridEditResult | Promise<GridEditResult>;
  /** `returnFocus` is true when Enter or Escape closed the editor, false when focus had already left it. */
  close: (returnFocus: boolean) => void;
}) {
  const translate = useTranslate();
  const [value, setValue] = useState(initialValue);
  const [rejection, setRejection] = useState<GridEditRejection | null>(null);
  const saving = useRef(false);
  const closed = useRef(false);

  const commit = async (returnFocus: boolean) => {
    if (saving.current || closed.current) {
      return;
    }
    if (value !== initialValue) {
      saving.current = true;
      const result = await save(value);
      saving.current = false;
      if (!result.ok) {
        setRejection(result);
        return;
      }
    }
    closed.current = true;
    close(returnFocus);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void commit(true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closed.current = true;
      close(true);
    }
  };

  const message =
    rejection === null
      ? null
      : (translateOrNull(() => translate(rejection.messageKey, rejection.params)) ??
        translate('pl.ui.grid.editRejected'));

  return (
    <>
      <Input
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          void commit(false);
        }}
        aria-labelledby={labelledBy}
        aria-describedby={message === null ? hintId : `${errorId} ${hintId}`}
        aria-invalid={message === null ? undefined : true}
        className="h-7 px-2 font-[inherit]"
      />
      {message === null ? null : (
        <p
          id={errorId}
          role="alert"
          className="absolute top-full left-0 z-40 mt-0.5 w-64 rounded-md border border-danger bg-surface-overlay px-2 py-1 text-left font-sans text-xs whitespace-normal text-danger shadow-md"
        >
          {message}
        </p>
      )}
    </>
  );
}

function cellText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

interface ScrollState {
  readonly top: number;
  readonly height: number;
}

/**
 * A data grid following the ARIA APG grid pattern (KTD28): one tab stop, arrow, Home, End and Page keys,
 * sortable headers with `aria-sort`, a sticky header and a pinned first column. Grids of more than
 * 1,000 rows render only the rows in view and expose `aria-rowcount` and `aria-rowindex`.
 */
export function DataGrid<TData extends RowData>({
  label,
  data,
  columns: dataColumns,
  getRowId,
  selectable = false,
  onSelectionChange,
  onCellEdit,
  pageSize = 10,
  className,
}: DataGridProps<TData>) {
  const translate = useTranslate();
  const gridId = useId();
  const headerId = (columnId: string) => `${gridId}-column-${columnId}`;
  const rowHeaderId = (row: Row<GridFeatures, TData>) => rowHeaderElementId(gridId, row);
  const selectLabelId = selectLabelElementId(gridId);
  const editHintId = `${gridId}-edit-hint`;
  const editorHintId = `${gridId}-editor-hint`;
  const editorErrorId = `${gridId}-editor-error`;

  const columns = useMemo<GridColumns<TData>>(() => {
    if (!selectable) {
      return dataColumns;
    }
    const helper = createGridColumnHelper<TData>();
    const selectColumn = helper.display({
      id: selectColumnId,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          aria-label={translate('pl.ui.grid.selectAll')}
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onCheckedChange={(checked) => {
            table.toggleAllRowsSelected(checked);
          }}
          className={checkboxHitArea}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-labelledby={`${selectLabelElementId(gridId)} ${rowHeaderElementId(gridId, row)}`}
          checked={row.getIsSelected()}
          onCheckedChange={(checked) => {
            row.toggleSelected(checked);
          }}
          className={checkboxHitArea}
        />
      ),
    });
    return [selectColumn, ...dataColumns];
  }, [dataColumns, gridId, selectable, translate]);

  const table = useTable({ features: gridFeatures, columns, data, getRowId, sortDescFirst: false });
  const rows = table.getRowModel().rows;
  const headers = table.getHeaderGroups()[0]?.headers ?? [];
  const pinnedCount = selectable ? 2 : 1;

  const selection = table.state.rowSelection;
  useEffect(() => {
    onSelectionChange?.(Object.keys(selection));
  }, [selection, onSelectionChange]);

  const bodyRowKeys = useMemo(() => rows.map((row) => row.id), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState<ScrollState>({ top: 0, height: 0 });
  const windowed = rows.length > windowingThreshold;

  // By row and column id, so an open editor stays with its row when the rows reorder.
  const [editing, setEditing] = useState<{ rowId: string; columnId: string } | null>(null);

  const revealRow = useCallback(
    (position: GridPosition) => {
      const container = scrollRef.current;
      if (!windowed || container === null || position.row === 0) {
        return;
      }
      const headerHeight = container.querySelector('thead')?.offsetHeight ?? gridRowHeight;
      const top = scrollTopRevealing(position.row - 1, {
        scrollTop: container.scrollTop,
        viewportHeight: container.clientHeight,
        headerHeight,
      });
      container.scrollTop = top;
      setScroll({ top, height: container.clientHeight });
    },
    [windowed],
  );

  const isEditable = (position: GridPosition) => {
    const header = headers[position.column];
    return position.row > 0 && onCellEdit !== undefined && header?.column.columnDef.meta?.editable === true;
  };

  const startEditing = (position: GridPosition): boolean => {
    const row = rows[position.row - 1];
    const header = headers[position.column];
    if (!isEditable(position) || row === undefined || header === undefined) {
      return false;
    }
    setEditing({ rowId: row.id, columnId: header.column.id });
    keyboard.focusCell(position);
    return true;
  };

  const keyboard = useGridKeyboard({
    bodyRowKeys,
    columnCount: headers.length,
    pageSize,
    isEditing: editing !== null,
    onActivateCell: startEditing,
    onBeforeMove: revealRow,
  });

  const activeBodyRow = keyboard.active.row > 0 ? keyboard.active.row - 1 : null;
  const items = rowItems(
    rowWindow({ rowCount: rows.length, scrollTop: scroll.top, viewportHeight: scroll.height }),
    rows.length,
    activeBodyRow,
  );

  // Scroll padding keeps a focused cell clear of the sticky header and pinned columns (WCAG 2.4.11).
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (container === null) {
      return;
    }
    const headerCells = container.querySelectorAll<HTMLElement>('thead th');
    let pinnedWidth = 0;
    for (const [index, cell] of headerCells.entries()) {
      if (index < pinnedCount) {
        pinnedWidth += cell.offsetWidth;
      }
    }
    container.style.scrollPaddingTop = `${container.querySelector('thead')?.offsetHeight ?? 0}px`;
    container.style.scrollPaddingLeft = `${pinnedWidth}px`;
    if (container.clientHeight !== scroll.height) {
      setScroll({ top: container.scrollTop, height: container.clientHeight });
    }
  });

  const saveEdit =
    (row: Row<GridFeatures, TData>, columnId: string) =>
    (value: string): GridEditResult | Promise<GridEditResult> =>
      onCellEdit?.({ rowId: row.id, columnId, value }) ?? { ok: true };

  const closeEditor = (row: Row<GridFeatures, TData>, columnIndex: number) => (returnFocus: boolean) => {
    setEditing(null);
    // A blur leaves focus where the person moved it; the tab stop stays on the edited cell.
    if (returnFocus) {
      keyboard.focusRow(row.id, columnIndex);
    }
  };

  const renderHeader = (header: (typeof headers)[number], columnIndex: number): ReactNode => {
    const column = header.column;
    const canSort = column.getCanSort();
    const direction = column.getIsSorted();
    const pinned = columnIndex < pinnedCount;
    return (
      <th
        key={header.id}
        id={headerId(column.id)}
        scope="col"
        {...{ [gridCellAttribute]: `0:${columnIndex}` }}
        aria-sort={canSort ? (direction === false ? 'none' : ariaSortValues[direction]) : undefined}
        className={cn(
          cellClasses,
          headerClasses,
          pinned && 'z-30',
          pinned && (columnIndex === 1 ? 'left-10' : 'left-0'),
          column.id === selectColumnId && 'w-10 px-0 text-center',
          column.columnDef.meta?.numeric === true && 'text-right',
        )}
      >
        {canSort ? (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-sm font-medium text-muted hover:text-primary',
              column.columnDef.meta?.numeric === true && 'flex-row-reverse',
              focusRing,
            )}
          >
            <table.FlexRender header={header} />
            <SortIcon direction={direction} />
          </button>
        ) : (
          <table.FlexRender header={header} />
        )}
      </th>
    );
  };

  const renderCell = (
    row: Row<GridFeatures, TData>,
    cell: ReturnType<Row<GridFeatures, TData>['getAllCells']>[number],
    rowIndex: number,
    columnIndex: number,
  ): ReactNode => {
    const column = cell.column;
    const position = { row: rowIndex, column: columnIndex };
    const meta = column.columnDef.meta;
    const isRowHeader = columnIndex === pinnedCount - 1;
    const editable = isEditable(position);
    const isEditing = editing !== null && editing.rowId === row.id && editing.columnId === column.id;
    const Element = isRowHeader ? 'th' : 'td';
    return (
      <Element
        key={cell.id}
        id={isRowHeader ? rowHeaderId(row) : undefined}
        scope={isRowHeader ? 'row' : undefined}
        {...{ [gridCellAttribute]: `${rowIndex}:${columnIndex}` }}
        aria-describedby={editable && !isEditing ? editHintId : undefined}
        onDoubleClick={
          editable
            ? () => {
                startEditing(position);
              }
            : undefined
        }
        className={cn(
          cellClasses,
          'text-primary',
          columnIndex < pinnedCount && pinnedClasses,
          columnIndex < pinnedCount && (columnIndex === 1 ? 'left-10' : 'left-0'),
          isRowHeader && 'font-medium',
          column.id === selectColumnId && 'w-10 px-0 text-center',
          meta?.numeric === true && 'text-right font-mono tabular-nums',
          editable && 'cursor-text',
          isEditing && 'px-1',
          isEditing && columnIndex >= pinnedCount && 'relative',
        )}
      >
        {isEditing ? (
          <CellEditor
            initialValue={cellText(cell.getValue())}
            labelledBy={`${headerId(column.id)} ${rowHeaderId(row)}`}
            hintId={editorHintId}
            errorId={editorErrorId}
            save={saveEdit(row, column.id)}
            close={closeEditor(row, columnIndex)}
          />
        ) : editable ? (
          <span className="underline decoration-line-strong decoration-dotted underline-offset-4">
            <table.FlexRender cell={cell} />
          </span>
        ) : (
          <table.FlexRender cell={cell} />
        )}
      </Element>
    );
  };

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const container = event.currentTarget;
        if (windowed) {
          setScroll({ top: container.scrollTop, height: container.clientHeight });
        }
      }}
      className={cn('relative overflow-auto rounded-md border border-line', raisedSurface, className)}
    >
      <span hidden id={selectLabelId}>
        {translate('pl.ui.grid.selectRow')}
      </span>
      <span hidden id={editHintId}>
        {translate('pl.ui.grid.editHint')}
      </span>
      <span hidden id={editorHintId}>
        {translate('pl.ui.grid.editorHint')}
      </span>
      <table
        ref={keyboard.gridRef}
        role="grid"
        aria-label={label}
        aria-rowcount={windowed ? rows.length + 1 : undefined}
        aria-multiselectable={selectable ? true : undefined}
        onKeyDown={keyboard.onKeyDown}
        onFocus={keyboard.onFocus}
        className="w-full border-separate border-spacing-0 text-sm"
      >
        <thead>
          <tr aria-rowindex={windowed ? 1 : undefined}>{headers.map(renderHeader)}</tr>
        </thead>
        <tbody>
          {items.map((item) => {
            if (item.kind === 'spacer') {
              return (
                <tr key={`pl-spacer-${item.firstIndex}`} aria-hidden>
                  <td colSpan={headers.length} style={{ height: item.height }} className="p-0" />
                </tr>
              );
            }
            const row = rows[item.index];
            if (row === undefined) {
              return null;
            }
            const rowIndex = item.index + 1;
            return (
              <tr
                key={row.id}
                aria-rowindex={windowed ? rowIndex + 1 : undefined}
                aria-selected={selectable ? row.getIsSelected() : undefined}
                style={{ height: gridRowHeight }}
                className="group"
              >
                {row.getAllCells().map((cell, columnIndex) => renderCell(row, cell, rowIndex, columnIndex))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
