// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TranslationProvider } from '../i18n/translation';
import { previewCatalogue } from '../preview/catalogue';
import { sampleParts, type SamplePartRow } from '../preview/sample-data';
import { samplePartStates } from '../preview/sample-states';
import { createGridColumnHelper, DataGrid, type DataGridProps } from './data-grid';
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

  it('enters edit mode on Enter and returns to the cell on Escape without reporting an edit', () => {
    const onCellEdit = vi.fn();
    const container = mountGrid({ onCellEdit });
    act(() => {
      query(container, '[data-grid-cell="1:2"]').focus();
    });
    press('Enter');
    const editor = query(container, '[data-grid-cell="1:2"] input');
    expect(document.activeElement).toBe(editor);
    press('ArrowLeft');
    expect(document.activeElement).toBe(editor);
    press('Escape');
    expect(container.querySelector('input')).toBeNull();
    expect(focusedCell()).toBe('1:2');
    expect(document.activeElement?.hasAttribute('data-grid-cell')).toBe(true);
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it('reports the new value when an edit is committed with Enter', () => {
    const onCellEdit = vi.fn();
    const container = mountGrid({ onCellEdit });
    act(() => {
      query(container, '[data-grid-cell="1:2"]').focus();
    });
    press('Enter');
    const editor = query(container, '[data-grid-cell="1:2"] input');
    if (!(editor instanceof HTMLInputElement)) {
      throw new Error('The editor is not an input');
    }
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(editor, '40');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    press('Enter');
    expect(onCellEdit).toHaveBeenCalledExactlyOnceWith({ rowId: 'part-1', columnId: 'quantity', value: '40' });
    expect(focusedCell()).toBe('1:2');
  });

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
