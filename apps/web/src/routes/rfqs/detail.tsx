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
import { useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { useApiQuery } from '../../api/api-client';
import { actionAvailability } from '../../shell/action-availability';
import { ActionButton } from '../../shell/action-button';
import { useDocumentTitle } from '../../shell/document-title';
import { formatDate, formatInstantUtc, formatNumber } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { DriftCell } from './drift-cell';
import { AmendDialog, ExtendDeadlineDialog } from './rfq-change-dialogs';
import { withAmendment, withExtendedDeadline, type AmendForm, type ExtendForm } from './rfq-changes';
import { Fact, RfqHeader } from './rfq-header';
import { useRfqPreview } from './rfq-preview';

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
      <ChangeActions detail={detail} />
      <ResponsesSection detail={detail} />
      <LinesSection detail={detail} />
    </>
  );
}

const notYetAvailableKey = 'pl.rfqs.changes.notYetAvailable';

/**
 * Amending and extending the deadline (R16), each offered as the read allows: once staff have
 * seen the answers after close, the server blocks the extension and says why.
 */
function ChangeActions({ detail }: { detail: RfqDetail }) {
  const translate = useTranslate();
  const preview = useRfqPreview();
  const [open, setOpen] = useState<'amend' | 'extend' | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const amend = actionAvailability(detail, 'amend', preview !== null, notYetAvailableKey);
  const extend = actionAvailability(detail, 'extendDeadline', preview !== null, notYetAvailableKey);
  if (amend.kind === 'hidden' && extend.kind === 'hidden') {
    return null;
  }

  const finish = async (next: RfqDetail, messageKey: string, params: Record<string, string | number>) => {
    await preview?.save({ detail: next });
    setOutcome(translate(messageKey, params));
    returnFocusTo.current = status.current;
    setOpen(null);
  };

  return (
    <section aria-labelledby="changes-heading" className="flex flex-col gap-2">
      <h2 id="changes-heading" className="sr-only">
        {translate('pl.rfqs.changes.title')}
      </h2>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          availability={amend}
          onAction={() => {
            returnFocusTo.current = null;
            setOpen('amend');
          }}
        >
          {translate('pl.rfqs.changes.amend')}
        </ActionButton>
        <ActionButton
          availability={extend}
          onAction={() => {
            returnFocusTo.current = null;
            setOpen('extend');
          }}
        >
          {translate('pl.rfqs.changes.extend')}
        </ActionButton>
      </div>
      <p ref={status} role="status" tabIndex={-1} className="text-sm font-medium text-success outline-hidden">
        {outcome}
      </p>
      <AmendDialog
        detail={detail}
        open={open === 'amend'}
        returnFocusTo={returnFocusTo}
        onAmended={(form: AmendForm) => {
          const next = withAmendment(detail, form);
          const line = detail.lines.find((candidate) => candidate.lineId === form.lineId);
          void finish(next, 'pl.rfqs.amend.done', { version: next.version, line: line?.lineNumber ?? 0 });
        }}
        onClose={() => {
          setOpen(null);
        }}
      />
      <ExtendDeadlineDialog
        detail={detail}
        open={open === 'extend'}
        returnFocusTo={returnFocusTo}
        onExtended={(form: ExtendForm) => {
          void finish(withExtendedDeadline(detail, form), 'pl.rfqs.extend.done', {
            deadline: formatInstantUtc(form.deadline),
          });
        }}
        onClose={() => {
          setOpen(null);
        }}
      />
    </section>
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
            <Link
              to="/rfqs/$rfqId/assignment"
              params={{ rfqId: detail.rfqId }}
              className={buttonVariants({ variant: 'secondary' })}
            >
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
        lineHelper.accessor((line) => line.quantityBreaks.join(', '), {
          id: 'quantityBreaks',
          header: () => translate('pl.rfqs.detail.column.quantityBreaks'),
          cell: ({ row }) =>
            row.original.quantityBreaks.length === 0 ? (
              <span className="text-muted">{translate('pl.rfqs.detail.noBreaks')}</span>
            ) : (
              <Mono>{row.original.quantityBreaks.map(formatNumber).join(', ')}</Mono>
            ),
        }),
        lineHelper.accessor('requiredBy', {
          header: () => translate('pl.rfqs.detail.column.requiredBy'),
          cell: ({ getValue }) => <Mono>{formatDate(getValue())}</Mono>,
        }),
        lineHelper.accessor((line) => (line.drift === null ? 0 : 1), {
          id: 'drift',
          header: () => translate('pl.rfqs.detail.column.drift'),
          cell: ({ row }) => <DriftCell drift={row.original.drift} />,
        }),
      ]),
    [translate],
  );
  return (
    <section aria-labelledby="lines-heading" className="flex flex-col gap-3">
      <h2 id="lines-heading" className="text-lg font-semibold">
        {translate('pl.rfqs.detail.lines.title')}
      </h2>
      {detail.lines.some((line) => line.drift !== null) ? (
        <p className="max-w-prose text-sm text-muted">{translate('pl.rfqs.drift.notice')}</p>
      ) : null}
      <DataGrid
        label={translate('pl.rfqs.detail.lines.gridLabel', { reference: detail.reference })}
        data={detail.lines}
        columns={columns}
        getRowId={(line) => line.lineId}
      />
    </section>
  );
}
