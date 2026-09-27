import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useMemo, useState } from 'react';
import { z } from 'zod';

import { Mono } from '../components/display';
import { useTranslate, type Translate } from '../i18n/translation';
import { sampleParts, type SamplePartRow } from '../preview/sample-data';
import { samplePartStates } from '../preview/sample-states';
import { createGridColumnHelper, DataGrid, type GridCellEdit } from './data-grid';
import { GridLegend, StateBadge } from './state-badge';

const meta = { title: 'Grid' } satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

const helper = createGridColumnHelper<SamplePartRow>();

function partColumns(translate: Translate) {
  return helper.columns([
    helper.accessor('number', {
      header: () => translate('pl.preview.partNumber'),
      cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
    }),
    helper.accessor('revision', { header: () => translate('pl.preview.revision') }),
    helper.accessor('description', { header: () => translate('pl.preview.description') }),
    helper.accessor('material', { header: () => translate('pl.preview.material') }),
    helper.accessor('status', {
      header: () => translate('pl.preview.status'),
      cell: ({ getValue }) => <StateBadge state={samplePartStates[getValue()]} />,
    }),
    helper.accessor('quantity', {
      header: () => translate('pl.preview.quantity'),
      meta: { numeric: true, editable: true },
    }),
    helper.accessor('unitPrice', {
      header: () => translate('pl.preview.unitPrice'),
      cell: ({ getValue }) => getValue().toFixed(2),
      meta: { numeric: true },
    }),
  ]);
}

const quantitySchema = z.coerce.number().int().positive();

const getPartId = (part: SamplePartRow) => part.id;

function PartsGridPreview() {
  const translate = useTranslate();
  const [parts, setParts] = useState(() => sampleParts(40));
  const [selectedCount, setSelectedCount] = useState(0);
  const columns = useMemo(() => partColumns(translate), [translate]);
  const onCellEdit = useCallback(({ rowId, value }: GridCellEdit) => {
    const quantity = quantitySchema.safeParse(value);
    if (quantity.success) {
      setParts((current) => current.map((part) => (part.id === rowId ? { ...part, quantity: quantity.data } : part)));
    }
  }, []);
  const onSelectionChange = useCallback((ids: readonly string[]) => {
    setSelectedCount(ids.length);
  }, []);
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <GridLegend states={Object.values(samplePartStates)} />
      <DataGrid
        label={translate('pl.preview.partsGrid')}
        data={parts}
        columns={columns}
        getRowId={getPartId}
        selectable
        onSelectionChange={onSelectionChange}
        onCellEdit={onCellEdit}
        className="max-h-96"
      />
      <p className="text-sm text-muted" role="status">
        {translate('pl.preview.selectedCount', { count: selectedCount })}
      </p>
    </div>
  );
}

export const Parts: Story = { render: () => <PartsGridPreview /> };

const catalogue = sampleParts(5000);

function CatalogueGridPreview() {
  const translate = useTranslate();
  const columns = useMemo(() => partColumns(translate), [translate]);
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <GridLegend states={Object.values(samplePartStates)} />
      <DataGrid
        label={translate('pl.preview.catalogueGrid')}
        data={catalogue}
        columns={columns}
        getRowId={getPartId}
        className="max-h-96"
      />
    </div>
  );
}

export const LargeCatalogue: Story = { render: () => <CatalogueGridPreview /> };
