// @vitest-environment happy-dom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TranslationProvider } from '../i18n/translation';
import { previewCatalogue } from '../preview/catalogue';
import { sampleParts, type SamplePartRow } from '../preview/sample-data';
import { samplePartStates } from '../preview/sample-states';
import {
  createGridColumnHelper,
  DataGrid,
  type DataGridProps,
  type GridCellEdit,
  type GridEditResult,
} from './data-grid';
import { GridLegend, StateBadge } from './state-badge';

const helper = createGridColumnHelper<SamplePartRow>();

const columns = helper.columns([
  helper.accessor('number', { header: 'Part number' }),
  helper.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: ({ getValue }) => <StateBadge state={samplePartStates[getValue()]} />,
  }),
  helper.accessor('quantity', { header: 'Quantity', meta: { numeric: true, editable: true } }),
]);

const getPartId = (part: SamplePartRow) => part.id;

let root: Root | null = null;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  document.body.replaceChildren();
});

function mount(node: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const created = createRoot(container);
  root = created;
  act(() => {
    created.render(<TranslationProvider catalogue={previewCatalogue}>{node}</TranslationProvider>);
  });
  return container;
}

function mountGrid(props: Partial<DataGridProps<SamplePartRow>> = {}): HTMLElement {
  return mount(<DataGrid label="Parts" data={sampleParts(3)} columns={columns} getRowId={getPartId} {...props} />);
}

function query(container: HTMLElement, selector: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`Nothing matches ${selector}`);
  }
  return element;
}

function press(key: string, options: KeyboardEventInit = {}): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
}

function tabStops(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="grid"] *')].filter((element) => element.tabIndex === 0);
}

function focusedCell(): string | null {
  return document.activeElement?.closest('[data-grid-cell]')?.getAttribute('data-grid-cell') ?? null;
}

describe('data grid structure', () => {
  it('renders a named grid with column headers and a row header for the first column', () => {
    const container = mountGrid();
    expect(query(container, '[role="grid"]').getAttribute('aria-label')).toBe('Parts');
    const scopes = [...container.querySelectorAll('thead th')].map((header) => header.getAttribute('scope'));
    expect(scopes).toEqual(['col', 'col', 'col']);
    const rowHeaders = [...container.querySelectorAll('tbody th[scope="row"]')].map((header) => header.textContent);
    expect(rowHeaders).toEqual(['PL-10001', 'PL-10008', 'PL-10015']);
  });

  it('gives sortable headers aria-sort and leaves it off headers that cannot sort', () => {
    const container = mountGrid();
    const sorts = [...container.querySelectorAll('thead th')].map((header) => header.getAttribute('aria-sort'));
    expect(sorts).toEqual(['none', null, 'none']);
    expect(container.querySelectorAll('thead th button')).toHaveLength(2);
  });

  it('cycles a sortable header through ascending, descending and unsorted', () => {
    const container = mountGrid();
    const header = query(container, 'thead th');
    const button = query(header, 'button');
    act(() => {
      button.click();
    });
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    act(() => {
      button.click();
    });
    expect(header.getAttribute('aria-sort')).toBe('descending');
    expect(query(container, 'tbody th').textContent).toBe('PL-10015');
    act(() => {
      button.click();
    });
    expect(header.getAttribute('aria-sort')).toBe('none');
  });

  it('adds a selection column whose checkboxes are named by their row header', () => {
    const container = mountGrid({ selectable: true });
    expect(query(container, '[role="grid"]').getAttribute('aria-multiselectable')).toBe('true');
    expect(query(container, 'thead [role="checkbox"]').getAttribute('aria-label')).toBe('Select all rows');
    const names = (query(container, 'tbody [role="checkbox"]').getAttribute('aria-labelledby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(names).toEqual(['Select', 'PL-10001']);
    expect(query(container, 'tbody tr').getAttribute('aria-selected')).toBe('false');
  });

  it('gives row checkboxes a 24-pixel hit area around the 16-pixel box', () => {
    const container = mountGrid({ selectable: true });
    const classes = query(container, 'tbody [role="checkbox"]').className;
    expect(classes).toContain('size-4');
    expect(classes).toContain('after:-inset-[5px]');
  });

  it('exposes a state badge by the same name as its legend entry', () => {
    const container = mount(
      <>
        <GridLegend states={Object.values(samplePartStates)} />
        <DataGrid label="Parts" data={sampleParts(4)} columns={columns} getRowId={getPartId} />
      </>,
    );
    for (const state of Object.values(samplePartStates)) {
      const legendEntry = query(container, `[data-legend-entry="${state.id}"]`);
      const badgeName = query(container, `[data-state-badge="${state.id}"] .sr-only`);
      expect(badgeName.textContent).not.toBe('');
      expect(badgeName.textContent).toBe(legendEntry.textContent);
      expect(query(container, `[data-state-badge="${state.id}"] svg`).getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('renders every row without aria-rowcount up to 1,000 rows', () => {
    const container = mountGrid({ data: sampleParts(1000) });
    expect(query(container, '[role="grid"]').hasAttribute('aria-rowcount')).toBe(false);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1000);
    expect(query(container, 'tbody tr').hasAttribute('aria-rowindex')).toBe(false);
  });

  it('renders a window of rows with aria-rowcount and aria-rowindex above 1,000 rows', () => {
    const container = mountGrid({ data: sampleParts(1001) });
    expect(query(container, '[role="grid"]').getAttribute('aria-rowcount')).toBe('1002');
    const rows = [...container.querySelectorAll('tbody tr:not([aria-hidden])')];
    expect(rows.length).toBeLessThan(50);
    expect(rows.slice(0, 3).map((row) => row.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4']);
    expect(query(container, 'thead tr').getAttribute('aria-rowindex')).toBe('1');
  });
});

describe('data grid keyboard', () => {
  it('has exactly one tab stop, on the first header cell', () => {
    const container = mountGrid({ selectable: true });
    const stops = tabStops(container);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.getAttribute('aria-label')).toBe('Select all rows');
  });

  it('moves focus and the single tab stop one cell per arrow key', () => {
    const container = mountGrid();
    act(() => {
      tabStops(container)[0]?.focus();
    });
    expect(focusedCell()).toBe('0:0');
    press('ArrowDown');
    expect(focusedCell()).toBe('1:0');
    expect(document.activeElement?.textContent).toBe('PL-10001');
    press('ArrowRight');
    expect(focusedCell()).toBe('1:1');
    press('End');
    expect(focusedCell()).toBe('1:2');
    press('Home');
    expect(focusedCell()).toBe('1:0');
    press('End', { ctrlKey: true });
    expect(focusedCell()).toBe('3:2');
    expect(tabStops(container)).toEqual([document.activeElement]);
  });
});

function accepting() {
  return vi.fn<(edit: GridCellEdit) => GridEditResult | Promise<GridEditResult>>(() => ({ ok: true }));
}

function openEditor(container: HTMLElement, cell: string): HTMLInputElement {
  act(() => {
    query(container, `[data-grid-cell="${cell}"]`).focus();
  });
  press('Enter');
  const editor = query(container, `[data-grid-cell="${cell}"] input`);
  if (!(editor instanceof HTMLInputElement)) {
    throw new Error('The editor is not an input');
  }
  return editor;
}

function typeInto(editor: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(editor, value);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function pressAndSettle(key: string): Promise<void> {
  const target = document.activeElement ?? document.body;
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

/** A grid that owns its data, as a screen does, so accepted edits change the rows. */
function EditableParts() {
  const [parts, setParts] = useState(() => sampleParts(3));
  return (
    <DataGrid
      label="Parts"
      data={parts}
      columns={columns}
      getRowId={getPartId}
      onCellEdit={(edit) => {
        setParts((current) =>
          current.map((part) => (part.id === edit.rowId ? { ...part, quantity: Number(edit.value) } : part)),
        );
        return { ok: true };
      }}
    />
  );
}

describe('data grid editing', () => {
  it('enters edit mode on Enter and returns to the cell on Escape without reporting an edit', () => {
    const onCellEdit = accepting();
    const container = mountGrid({ onCellEdit });
    const editor = openEditor(container, '1:2');
    expect(document.activeElement).toBe(editor);
    press('ArrowLeft');
    expect(document.activeElement).toBe(editor);
    typeInto(editor, '40');
    press('Escape');
    expect(container.querySelector('input')).toBeNull();
    expect(focusedCell()).toBe('1:2');
    expect(document.activeElement?.hasAttribute('data-grid-cell')).toBe(true);
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it('reports the new value when an edit is committed with Enter and returns focus to the cell', async () => {
    const onCellEdit = accepting();
    const container = mountGrid({ onCellEdit });
    typeInto(openEditor(container, '1:2'), '40');
    await pressAndSettle('Enter');
    expect(onCellEdit).toHaveBeenCalledExactlyOnceWith({ rowId: 'part-1', columnId: 'quantity', value: '40' });
    expect(container.querySelector('input')).toBeNull();
    expect(focusedCell()).toBe('1:2');
  });

  it('commits once when focus leaves the editor and leaves focus where it went', async () => {
    const onCellEdit = accepting();
    const container = mount(
      <>
        <DataGrid label="Parts" data={sampleParts(3)} columns={columns} getRowId={getPartId} onCellEdit={onCellEdit} />
        <input aria-label="Outside" />
      </>,
    );
    typeInto(openEditor(container, '1:2'), '40');
    const outside = query(container, 'input[aria-label="Outside"]');
    await act(async () => {
      outside.focus();
      await Promise.resolve();
    });
    expect(onCellEdit).toHaveBeenCalledExactlyOnceWith({ rowId: 'part-1', columnId: 'quantity', value: '40' });
    expect(container.querySelector('[role="grid"] input')).toBeNull();
    expect(document.activeElement).toBe(outside);
    expect(tabStops(container).map((element) => element.getAttribute('data-grid-cell'))).toEqual(['1:2']);
  });

  it('keeps a refused edit open, marked invalid and described by the translated message', async () => {
    const onCellEdit = vi.fn<(edit: GridCellEdit) => GridEditResult>(({ value }) =>
      value === 'abc' ? { ok: false, messageKey: 'pl.preview.quantityInvalid' } : { ok: true },
    );
    const container = mountGrid({ onCellEdit });
    const editor = openEditor(container, '1:2');
    typeInto(editor, 'abc');
    await pressAndSettle('Enter');
    expect(document.activeElement).toBe(editor);
    expect(editor.getAttribute('aria-invalid')).toBe('true');
    const [errorId] = (editor.getAttribute('aria-describedby') ?? '').split(' ');
    const error = document.getElementById(errorId ?? '');
    expect(error?.textContent).toBe('Enter a whole number greater than zero.');
    expect(error?.getAttribute('role')).toBe('alert');

    typeInto(editor, '30');
    await pressAndSettle('Enter');
    expect(container.querySelector('input')).toBeNull();
    expect(onCellEdit).toHaveBeenLastCalledWith({ rowId: 'part-1', columnId: 'quantity', value: '30' });
  });

  it('shows the generic refusal when the message key is unknown', async () => {
    const container = mountGrid({ onCellEdit: () => ({ ok: false, messageKey: 'pl.preview.noSuchMessage' }) });
    typeInto(openEditor(container, '1:2'), '7');
    await pressAndSettle('Enter');
    expect(query(container, '[role="alert"]').textContent).toBe('This value was not saved. Check it and try again.');
  });

  it('waits for an asynchronous result before closing the editor', async () => {
    let resolve: (result: GridEditResult) => void = () => undefined;
    const container = mountGrid({
      onCellEdit: () =>
        new Promise<GridEditResult>((settle) => {
          resolve = settle;
        }),
    });
    typeInto(openEditor(container, '1:2'), '40');
    await pressAndSettle('Enter');
    expect(container.querySelector('input')).not.toBeNull();
    await act(async () => {
      resolve({ ok: true });
      await Promise.resolve();
    });
    expect(container.querySelector('input')).toBeNull();
    expect(focusedCell()).toBe('1:2');
  });

  it('keeps focus on the edited row when the edit moves it in a sorted grid', async () => {
    const container = mount(<EditableParts />);
    const quantityHeader = query(container, 'thead th:nth-child(3) button');
    act(() => {
      quantityHeader.click();
    });
    expect(query(container, 'tbody th').textContent).toBe('PL-10001');
    typeInto(openEditor(container, '1:2'), '9999');
    await pressAndSettle('Enter');
    expect(query(container, 'tbody tr:last-child th').textContent).toBe('PL-10001');
    expect(focusedCell()).toBe('3:2');
    expect(document.activeElement?.closest('tr')?.querySelector('th')?.textContent).toBe('PL-10001');
    expect(document.activeElement?.textContent).toBe('9999');
  });
});

describe('data grid editing affordances', () => {
  it('does not open an editor for a cell that is not editable', () => {
    const container = mountGrid({ onCellEdit: vi.fn() });
    act(() => {
      query(container, '[data-grid-cell="1:0"]').focus();
    });
    press('Enter');
    expect(container.querySelector('input')).toBeNull();
  });

  it('describes an editable cell with the edit hint only when the grid accepts edits', () => {
    const editable = mountGrid({ onCellEdit: vi.fn() });
    const hintId = query(editable, '[data-grid-cell="1:2"]').getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(hintId)?.textContent).toBe('Press Enter to edit.');
    expect(query(editable, '[data-grid-cell="1:0"]').hasAttribute('aria-describedby')).toBe(false);
  });

  it('leaves cells without the edit hint when the grid takes no edits', () => {
    const readOnly = mountGrid();
    expect(query(readOnly, '[data-grid-cell="1:2"]').hasAttribute('aria-describedby')).toBe(false);
  });
});
