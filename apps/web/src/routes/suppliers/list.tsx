import { approvalStatuses, supplierListQuery, type SupplierList, type SupplierSummary } from '@partledger/contracts';
import {
  Button,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  GridLegend,
  Mono,
  StateBadge,
  useTranslate,
} from '@partledger/ui';
import { getRouteApi } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatDate } from '../../shell/format';
import { FilterBar, SearchFilter, SelectFilter } from '../../shell/list-filters';
import { QueryView } from '../../shell/query-view';
import { searchValue } from '../../shell/text-filter';
import { filterSuppliers, hasSupplierFilters } from './supplier-filters';
import { approvalExpiryStates, approvalStates, evidenceStateOf, identityStates } from './supplier-states';

const route = getRouteApi('/suppliers');

const anyApproval = 'all';

// Keys the expiry and identity icons, which repeat down their columns.
const legendStates = [...Object.values(approvalExpiryStates), ...Object.values(identityStates)];

export function SupplierListScreen() {
  const query = useApiQuery(supplierListQuery, {});
  return (
    <QueryView query={query} titleKey="pl.suppliers.list.title" loadingKey="pl.suppliers.list.loading">
      {(list) => <SupplierListView list={list} />}
    </QueryView>
  );
}

const helper = createGridColumnHelper<SupplierSummary>();

function SupplierListView({ list }: { list: SupplierList }) {
  const translate = useTranslate();
  useDocumentTitle('pl.suppliers.list.title');
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [filterGeneration, setFilterGeneration] = useState(0);
  const suppliers = filterSuppliers(list.suppliers, search);
  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', { header: () => translate('pl.suppliers.list.column.name') }),
        helper.accessor((supplier) => `${supplier.code} ${supplier.country}`, {
          id: 'code',
          header: () => translate('pl.suppliers.list.column.code'),
          cell: ({ row }) => (
            <Mono>
              {translate('pl.suppliers.list.codeAndCountry', {
                code: row.original.code,
                country: row.original.country,
              })}
            </Mono>
          ),
        }),
        helper.accessor((supplier) => supplier.approval.status, {
          id: 'approval',
          header: () => translate('pl.suppliers.list.column.approval'),
          cell: ({ getValue }) => <StateBadge state={approvalStates[getValue()]} showLabel />,
        }),
        helper.accessor(
          (supplier) =>
            supplier.approval.scope.map((category) => translate(`pl.parts.category.${category}`)).join(', '),
          {
            id: 'scope',
            header: () => translate('pl.suppliers.list.column.scope'),
            cell: ({ getValue }) => {
              const scope = getValue();
              return scope === '' ? (
                <span className="text-muted">{translate('pl.suppliers.list.noScope')}</span>
              ) : (
                <span className="block min-w-36 whitespace-normal">{scope}</span>
              );
            },
          },
        ),
        // Sorts by date, with approvals that never end last.
        helper.accessor((supplier) => supplier.approval.expiresOn ?? '9999-12-31', {
          id: 'expires',
          header: () => translate('pl.suppliers.list.column.expires'),
          cell: ({ row }) => {
            const { expiresOn, expiry } = row.original.approval;
            return (
              <span className="flex flex-col gap-0.5 py-1">
                {expiresOn === null ? null : <Mono>{formatDate(expiresOn)}</Mono>}
                <StateBadge state={approvalExpiryStates[expiry]} showLabel />
              </span>
            );
          },
        }),
        helper.accessor('evidence', {
          header: () => translate('pl.suppliers.list.column.evidence'),
          cell: ({ getValue }) => (
            <StateBadge state={evidenceStateOf(getValue())} showLabel className="whitespace-normal" />
          ),
        }),
        helper.accessor((supplier) => supplier.identityCheck.status, {
          id: 'identity',
          header: () => translate('pl.suppliers.list.column.identity'),
          cell: ({ row }) => {
            const check = row.original.identityCheck;
            return (
              <span className="flex flex-col gap-0.5 py-1">
                <StateBadge state={identityStates[check.status]} showLabel />
                {check.register === null || check.checkedAt === null ? null : (
                  <span className="text-xs text-muted">
                    {translate('pl.suppliers.identity.checkedAt', {
                      register: translate(`pl.suppliers.register.${check.register}`),
                      date: formatDate(check.checkedAt.slice(0, 10)),
                    })}
                  </span>
                )}
              </span>
            );
          },
        }),
      ]),
    [translate],
  );
  const approvalOptions = [
    { value: anyApproval, label: translate('pl.suppliers.filter.allApprovals') },
    ...approvalStatuses.map((status) => ({ value: status, label: translate(`pl.suppliers.approval.${status}`) })),
  ];

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{translate('pl.suppliers.list.title')}</h1>
        <p className="flex max-w-prose items-start gap-2 text-muted">
          <InfoIcon aria-hidden className="mt-1 size-4 shrink-0 text-info" />
          {translate(`pl.suppliers.list.source.${list.approvedListSource}`)}
        </p>
        <p className="max-w-prose text-sm text-muted">{translate('pl.suppliers.list.identityNotice')}</p>
      </div>
      {list.suppliers.length === 0 ? (
        <EmptyState
          titleKey="pl.suppliers.list.empty.title"
          descriptionKey="pl.suppliers.list.empty.description"
          action={null}
        />
      ) : (
        <section aria-label={translate('pl.suppliers.list.gridLabel')} className="flex flex-col gap-3">
          <FilterBar labelKey="pl.suppliers.filter.label">
            <SearchFilter
              key={filterGeneration}
              autoFocus={filterGeneration > 0}
              labelKey="pl.suppliers.filter.search"
              value={search.q ?? ''}
              onChange={(text) => {
                void navigate({ search: (previous) => ({ ...previous, q: searchValue(text) }), replace: true });
              }}
            />
            <SelectFilter
              labelKey="pl.suppliers.filter.approval"
              value={search.approval ?? anyApproval}
              options={approvalOptions}
              onChange={(value) => {
                const approval = approvalStatuses.find((status) => status === value);
                void navigate({ search: (previous) => ({ ...previous, approval }), replace: true });
              }}
            />
          </FilterBar>
          <p role="status" className="text-sm text-muted">
            {translate('pl.suppliers.list.count', { shown: suppliers.length, total: list.suppliers.length })}
          </p>
          <GridLegend states={legendStates} />
          {suppliers.length === 0 && hasSupplierFilters(search) ? (
            <EmptyState
              titleKey="pl.suppliers.list.noMatch.title"
              descriptionKey="pl.suppliers.list.noMatch.description"
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
                  {translate('pl.suppliers.list.noMatch.action')}
                </Button>
              }
            />
          ) : (
            <DataGrid
              label={translate('pl.suppliers.list.gridLabel')}
              data={suppliers}
              columns={columns}
              getRowId={(supplier) => supplier.supplierId}
            />
          )}
        </section>
      )}
    </>
  );
}
