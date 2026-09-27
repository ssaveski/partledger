import { rfqDetailQuery, type RfqDetail, type SupplierResponseStatus } from '@partledger/contracts';
import {
  buttonVariants,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  Mono,
  StateBadge,
  useTranslate,
  type GridStateDefinition,
} from '@partledger/ui';
import { getRouteApi, Link } from '@tanstack/react-router';
import { CircleCheckIcon, ClockIcon, EyeOffIcon } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';

import { useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatDate, formatInstantUtc, formatNumber } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { Fact, RfqHeader } from './rfq-header';

export const responseFilters = ['all', 'notYet'] as const;

export type ResponseFilter = (typeof responseFilters)[number];

/** `?show=notYet` lists only the suppliers still to respond, the ones a buyer chases. */
export const detailSearchSchema = z.object({
  show: z.enum(responseFilters).optional().catch(undefined),
});

const route = getRouteApi('/rfqs/$rfqId/');

const responseStates: Readonly<Record<SupplierResponseStatus['response'], GridStateDefinition>> = {
  responded: { id: 'responded', labelKey: 'pl.rfqs.response.responded', tone: 'success', icon: CircleCheckIcon },
  notYet: { id: 'notYet', labelKey: 'pl.rfqs.response.notYet', tone: 'warning', icon: ClockIcon },
};

export function DetailScreen() {
  const { rfqId } = route.useParams();
  const query = useApiQuery(rfqDetailQuery, { rfqId });
  return (
    <QueryView query={query} titleKey="pl.rfqs.detail.title" loadingKey="pl.rfqs.detail.loading">
      {(detail) => <RfqDetailView detail={detail} />}
    </QueryView>
  );
}

function RfqDetailView({ detail }: { detail: RfqDetail }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.detail.documentTitle', { reference: detail.reference });
  return (
    <>
      <RfqHeader
        rfqId={detail.rfqId}
        reference={detail.reference}
        title={detail.title}
        status={detail.status}
        screenKey="pl.rfqs.detail.title"
      >
        <Fact label={translate('pl.rfqs.detail.deadline')}>
          <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(detail.deadline) })}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.detail.version')}>
          <Mono>{formatNumber(detail.version)}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.detail.round')}>
          <Mono>{formatNumber(detail.round)}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.detail.currency')}>
          <Mono>{detail.currency}</Mono>
        </Fact>
      </RfqHeader>
      <ResponsesSection detail={detail} />
      <LinesSection detail={detail} />
    </>
  );
}

const supplierHelper = createGridColumnHelper<SupplierResponseStatus>();

function ResponsesSection({ detail }: { detail: RfqDetail }) {
  const translate = useTranslate();
  const { show = 'all' } = route.useSearch();
  const notYetCount = detail.suppliers.filter((supplier) => supplier.response === 'notYet').length;
  const suppliers =
    show === 'notYet' ? detail.suppliers.filter((supplier) => supplier.response === 'notYet') : detail.suppliers;
  const columns = useMemo(
    () =>
      supplierHelper.columns([
        supplierHelper.accessor('name', { header: () => translate('pl.rfqs.detail.column.supplier') }),
        supplierHelper.accessor('linesAssigned', {
          header: () => translate('pl.rfqs.detail.column.linesAssigned'),
          cell: ({ getValue }) => formatNumber(getValue()),
          meta: { numeric: true },
        }),
        supplierHelper.accessor('response', {
          header: () => translate('pl.rfqs.detail.column.response'),
          cell: ({ getValue }) => <StateBadge state={responseStates[getValue()]} showLabel />,
        }),
        supplierHelper.accessor('respondedAt', {
          header: () => translate('pl.rfqs.detail.column.respondedAt'),
          cell: ({ getValue }) => {
            const respondedAt = getValue();
            return respondedAt === null ? (
              <span className="text-muted">{translate('pl.rfqs.detail.notResponded')}</span>
            ) : (
              <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(respondedAt) })}</Mono>
            );
          },
        }),
      ]),
    [translate],
  );
  const sealed = detail.status === 'draft' || detail.status === 'published';
  return (
    <section aria-labelledby="responses-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="responses-heading" className="text-lg font-semibold">
            {translate('pl.rfqs.detail.responses.title')}
          </h2>
          {sealed ? (
            <p className="flex max-w-prose items-start gap-2 text-sm text-muted">
              <EyeOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
              {translate('pl.rfqs.detail.responses.sealedNotice')}
            </p>
          ) : null}
        </div>
        {detail.suppliers.length === 0 ? null : (
          <ul aria-label={translate('pl.rfqs.detail.filter.label')} className="flex gap-1">
            {responseFilters.map((filter) => (
              <li key={filter}>
                <Link
                  to="/rfqs/$rfqId"
                  params={{ rfqId: detail.rfqId }}
                  search={filter === 'all' ? {} : { show: filter }}
                  activeOptions={{ exact: true, includeSearch: true }}
                  className={buttonVariants({ variant: show === filter ? 'primary' : 'secondary', size: 'sm' })}
                >
                  {translate(`pl.rfqs.detail.filter.${filter}`, {
                    count: filter === 'all' ? detail.suppliers.length : notYetCount,
                  })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {detail.suppliers.length === 0 ? (
        <EmptyState
          headingLevel={3}
          titleKey="pl.rfqs.detail.responses.empty.title"
          descriptionKey="pl.rfqs.detail.responses.empty.description"
          action={
            <Link to="/" className={buttonVariants({ variant: 'secondary' })}>
              {translate('pl.rfqs.detail.responses.empty.action')}
            </Link>
          }
        />
      ) : suppliers.length === 0 ? (
        <EmptyState
          headingLevel={3}
          titleKey="pl.rfqs.detail.responses.allResponded.title"
          descriptionKey="pl.rfqs.detail.responses.allResponded.description"
          action={
            <Link
              to="/rfqs/$rfqId"
              params={{ rfqId: detail.rfqId }}
              search={{}}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {translate('pl.rfqs.detail.responses.allResponded.action')}
            </Link>
          }
        />
      ) : (
        <DataGrid
          label={translate('pl.rfqs.detail.responses.gridLabel', { reference: detail.reference })}
          data={suppliers}
          columns={columns}
          getRowId={(supplier) => supplier.supplierId}
        />
      )}
    </section>
  );
}

type DetailLine = RfqDetail['lines'][number];

const lineHelper = createGridColumnHelper<DetailLine>();

function LinesSection({ detail }: { detail: RfqDetail }) {
  const translate = useTranslate();
  const columns = useMemo(
    () =>
      lineHelper.columns([
        lineHelper.accessor('lineNumber', {
          header: () => translate('pl.rfqs.column.line'),
          cell: ({ getValue }) => <Mono>{formatNumber(getValue())}</Mono>,
        }),
        lineHelper.accessor('partNumber', {
          header: () => translate('pl.rfqs.column.part'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        lineHelper.accessor('revision', {
          header: () => translate('pl.rfqs.column.revision'),
          cell: ({ getValue }) => <Mono>{getValue()}</Mono>,
        }),
        lineHelper.accessor('description', { header: () => translate('pl.rfqs.column.description') }),
        lineHelper.accessor('quantity', {
          header: () => translate('pl.rfqs.column.quantity'),
          cell: ({ getValue }) => formatNumber(getValue()),
          meta: { numeric: true },
        }),
        lineHelper.accessor('requiredBy', {
          header: () => translate('pl.rfqs.detail.column.requiredBy'),
          cell: ({ getValue }) => <Mono>{formatDate(getValue())}</Mono>,
        }),
      ]),
    [translate],
  );
  return (
    <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
      <h2 id="lines-heading" className="text-lg font-semibold">
        {translate('pl.rfqs.detail.lines.title')}
      </h2>
      <DataGrid
        label={translate('pl.rfqs.detail.lines.gridLabel', { reference: detail.reference })}
        data={detail.lines}
        columns={columns}
        getRowId={(line) => line.lineId}
      />
    </section>
  );
}
