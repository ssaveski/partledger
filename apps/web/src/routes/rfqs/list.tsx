import { rfqListQuery, rfqStatuses, type RfqList, type RfqListRow } from '@partledger/contracts';
import {
  Button,
  buttonVariants,
  cn,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  focusRing,
  Mono,
  StateBadge,
  useTranslate,
} from '@partledger/ui';
import { getRouteApi, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatInstantUtc, formatNumber } from '../../shell/format';
import { FilterBar, SearchFilter, SelectFilter } from '../../shell/list-filters';
import { QueryView } from '../../shell/query-view';
import { searchValue } from '../../shell/text-filter';
import { driftStates } from './drift-states';
import { RfqStatusBadge } from './rfq-header';
import { filterRfqs, hasRfqFilters } from './rfq-list-filters';

const route = getRouteApi('/rfqs');

const anyStatus = 'all';

export function RfqListScreen() {
  const query = useApiQuery(rfqListQuery, {});
  return (
    <QueryView query={query} titleKey="pl.rfqs.list.title" loadingKey="pl.rfqs.list.loading">
      {(list) => <RfqListView list={list} />}
    </QueryView>
  );
}

/** Creating an RFQ starts from the parts list; the builder is where it happens. */
function NewRfqLink() {
  const translate = useTranslate();
  return (
    <Link to="/rfqs/new" className={buttonVariants({ variant: 'primary' })}>
      <PlusIcon aria-hidden />
      {translate('pl.rfqs.list.new')}
    </Link>
  );
}

const helper = createGridColumnHelper<RfqListRow>();

function RfqListView({ list }: { list: RfqList }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.list.title');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [filterGeneration, setFilterGeneration] = useState(0);
  const rfqs = filterRfqs(list.rfqs, search);
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('reference', {
          header: () => translate('pl.rfqs.list.column.reference'),
          cell: ({ row, getValue }) => (
            <Link
              to="/rfqs/$rfqId"
              params={{ rfqId: row.original.rfqId }}
              search={{}}
              className={cn(
                'rounded-sm font-mono text-primary underline decoration-accent underline-offset-4',
                focusRing,
              )}
            >
              {getValue()}
            </Link>
          ),
        }),
        helper.accessor('title', { header: () => translate('pl.rfqs.list.column.title') }),
        helper.accessor('status', {
          header: () => translate('pl.rfqs.list.column.status'),
          cell: ({ getValue }) => <RfqStatusBadge status={getValue()} />,
        }),
        helper.accessor('deadline', {
          header: () => translate('pl.rfqs.list.column.deadline'),
          cell: ({ getValue }) => (
            <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(getValue()) })}</Mono>
          ),
        }),
        helper.accessor('respondedCount', {
          header: () => translate('pl.rfqs.list.column.responses'),
          cell: ({ row }) =>
            translate('pl.rfqs.list.responses', {
              responded: row.original.respondedCount,
              invited: row.original.invitedCount,
            }),
        }),
        helper.accessor('lineCount', {
          header: () => translate('pl.rfqs.list.column.lines'),
          cell: ({ getValue }) => formatNumber(getValue()),
          meta: { numeric: true },
        }),
        helper.accessor('driftedLineCount', {
          header: () => translate('pl.rfqs.list.column.drift'),
          cell: ({ getValue }) => {
            const count = getValue();
            return count === 0 ? (
              <StateBadge state={driftStates.unchanged} showLabel className="text-muted" />
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <StateBadge state={driftStates.drifted} />
                {translate('pl.rfqs.list.driftedLines', { count })}
              </span>
            );
          },
        }),
      ]),
    [translate],
  );
  const statusOptions = [
    { value: anyStatus, label: translate('pl.rfqs.filter.allStatuses') },
    ...rfqStatuses.map((status) => ({ value: status, label: translate(`pl.rfqs.status.${status}`) })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{translate('pl.rfqs.list.title')}</h1>
          <p className="max-w-prose text-muted">{translate('pl.rfqs.list.description')}</p>
        </div>
        {list.rfqs.length === 0 ? null : <NewRfqLink />}
      </div>
      {list.rfqs.length === 0 ? (
        <EmptyState
          titleKey="pl.rfqs.list.empty.title"
          descriptionKey="pl.rfqs.list.empty.description"
          action={<NewRfqLink />}
        />
      ) : (
        <section aria-label={translate('pl.rfqs.list.gridLabel')} className="flex flex-col gap-3">
          <FilterBar labelKey="pl.rfqs.filter.label">
            <SearchFilter
              key={filterGeneration}
              autoFocus={filterGeneration > 0}
              labelKey="pl.rfqs.filter.search"
              value={search.q ?? ''}
              onChange={(text) => {
                void navigate({ search: (previous) => ({ ...previous, q: searchValue(text) }), replace: true });
              }}
            />
            <SelectFilter
              labelKey="pl.rfqs.filter.status"
              value={search.status ?? anyStatus}
              options={statusOptions}
              onChange={(value) => {
                const status = rfqStatuses.find((candidate) => candidate === value);
                void navigate({ search: (previous) => ({ ...previous, status }), replace: true });
              }}
            />
          </FilterBar>
          <p role="status" className="text-sm text-muted">
            {translate('pl.rfqs.list.count', { shown: rfqs.length, total: list.rfqs.length })}
          </p>
          {rfqs.length === 0 && hasRfqFilters(search) ? (
            <EmptyState
              titleKey="pl.rfqs.list.noMatch.title"
              descriptionKey="pl.rfqs.list.noMatch.description"
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
                  {translate('pl.rfqs.list.noMatch.action')}
                </Button>
              }
            />
          ) : (
            <DataGrid
              label={translate('pl.rfqs.list.gridLabel')}
              data={rfqs}
              columns={columns}
              getRowId={(rfq) => rfq.rfqId}
            />
          )}
        </section>
      )}
    </>
  );
}
