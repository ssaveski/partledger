import { partCategories, partListQuery, type PartList, type PartSummary } from '@partledger/contracts';
import {
  Button,
  buttonVariants,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  Mono,
  StateBadge,
  useTranslate,
} from '@partledger/ui';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatInstantUtc, formatNumber } from '../../shell/format';
import { FilterBar, SearchFilter, SelectFilter } from '../../shell/list-filters';
import { QueryView } from '../../shell/query-view';
import { searchValue } from '../../shell/text-filter';
import { filterParts, hasFilters } from './part-filters';
import { partSourceStates, partStatusStates } from './part-states';

const route = getRouteApi('/parts');

const allCategories = 'all';

export function PartListScreen() {
  const query = useApiQuery(partListQuery, {});
  return (
    <QueryView query={query} titleKey="pl.parts.list.title" loadingKey="pl.parts.list.loading">
      {(list) => <PartListView list={list} />}
    </QueryView>
  );
}

const helper = createGridColumnHelper<PartSummary>();

function PartListView({ list }: { list: PartList }) {
  const translate = useTranslate();
  useDocumentTitle('pl.parts.list.title');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const parts = filterParts(list.parts, search);
  const [filterGeneration, setFilterGeneration] = useState(0);
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('partNumber', {
          header: () => translate('pl.parts.list.column.part'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        helper.accessor('revision', {
          header: () => translate('pl.parts.list.column.revision'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        helper.accessor('description', { header: () => translate('pl.parts.list.column.description') }),
        helper.accessor((part) => translate(`pl.parts.category.${part.category}`), {
          id: 'category',
          header: () => translate('pl.parts.list.column.category'),
        }),
        helper.accessor('source', {
          header: () => translate('pl.parts.list.column.source'),
          cell: ({ getValue }) => <StateBadge state={partSourceStates[getValue()]} showLabel />,
        }),
        helper.accessor((part) => (part.active ? 'active' : 'inactive'), {
          id: 'status',
          header: () => translate('pl.parts.list.column.status'),
          cell: ({ getValue }) => <StateBadge state={partStatusStates[getValue()]} showLabel />,
        }),
        helper.accessor('approvedSupplierCount', {
          header: () => translate('pl.parts.list.column.approvedSuppliers'),
          cell: ({ getValue }) => formatNumber(getValue()),
          meta: { numeric: true },
        }),
        helper.accessor('updatedAt', {
          header: () => translate('pl.parts.list.column.updatedAt'),
          cell: ({ getValue }) => (
            <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(getValue()) })}</Mono>
          ),
        }),
      ]),
    [translate],
  );
  const categoryOptions = [
    { value: allCategories, label: translate('pl.parts.filter.allCategories') },
    ...partCategories.map((category) => ({ value: category, label: translate(`pl.parts.category.${category}`) })),
  ];

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{translate('pl.parts.list.title')}</h1>
        <p className="max-w-prose text-muted">{translate('pl.parts.list.description')}</p>
      </div>
      {list.parts.length === 0 ? (
        <EmptyState
          titleKey="pl.parts.list.empty.title"
          descriptionKey="pl.parts.list.empty.description"
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {translate('pl.parts.list.empty.action')}
            </Link>
          }
        />
      ) : (
        <section aria-label={translate('pl.parts.list.gridLabel')} className="flex flex-col gap-3">
          <FilterBar labelKey="pl.parts.filter.label">
            <SearchFilter
              key={filterGeneration}
              autoFocus={filterGeneration > 0}
              labelKey="pl.parts.filter.search"
              value={search.q ?? ''}
              onChange={(text) => {
                void navigate({ search: (previous) => ({ ...previous, q: searchValue(text) }), replace: true });
              }}
            />
            <SelectFilter
              labelKey="pl.parts.filter.category"
              value={search.category ?? allCategories}
              options={categoryOptions}
              onChange={(value) => {
                const category = partCategories.find((candidate) => candidate === value);
                void navigate({ search: (previous) => ({ ...previous, category }), replace: true });
              }}
            />
          </FilterBar>
          <p role="status" className="text-sm text-muted">
            {translate('pl.parts.list.count', { shown: parts.length, total: list.parts.length })}
          </p>
          {parts.length === 0 && hasFilters(search) ? (
            <EmptyState
              headingLevel={2}
              titleKey="pl.parts.list.noMatch.title"
              descriptionKey="pl.parts.list.noMatch.description"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Remounts the search field once the address no longer holds the text.
                    void navigate({ search: {}, replace: true }).then(() => {
                      setFilterGeneration((generation) => generation + 1);
                    });
                  }}
                >
                  {translate('pl.parts.list.noMatch.action')}
                </Button>
              }
            />
          ) : (
            <DataGrid
              label={translate('pl.parts.list.gridLabel')}
              data={parts}
              columns={columns}
              getRowId={(part) => part.partId}
            />
          )}
        </section>
      )}
    </>
  );
}
