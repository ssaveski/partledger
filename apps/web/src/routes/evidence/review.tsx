import {
  evidenceDownloadPath,
  reviewQueueQuery,
  type EvidenceGap,
  type ReviewDocument,
  type ReviewQueue,
} from '@partledger/contracts';
import {
  Button,
  buttonVariants,
  cn,
  createGridColumnHelper,
  DataGrid,
  EmptyState,
  Mono,
  raisedSurface,
  StateBadge,
  useTranslate,
} from '@partledger/ui';
import { Link } from '@tanstack/react-router';
import { DownloadIcon, InfoIcon } from 'lucide-react';
import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { useAdapterKind, useApiQuery, usePreviewWrite } from '../../api/api-client';
import { actionAvailability, type ActionAvailability } from '../../shell/action-availability';
import { ActionButton } from '../../shell/action-button';
import { useDocumentTitle } from '../../shell/document-title';
import { formatBytes, formatDate, formatInstantUtc, shortHash } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { Fact } from '../rfqs/rfq-header';
import { gapKey, withDeviation, withoutDocument, type DeviationForm } from './evidence-review';
import { deviationStates, documentExpiryStates, problemStates, scanStates } from './evidence-states';
import { DeviationDialog, RejectDialog } from './review-dialogs';

const notYetAvailableKey = 'pl.evidence.preview.notYetAvailable';

export function EvidenceReviewScreen() {
  const query = useApiQuery(reviewQueueQuery, {});
  return (
    <QueryView query={query} titleKey="pl.evidence.review.title" loadingKey="pl.evidence.review.loading">
      {(queue) => <ReviewView queue={queue} />}
    </QueryView>
  );
}

function ReviewView({ queue }: { queue: ReviewQueue }) {
  const translate = useTranslate();
  useDocumentTitle('pl.evidence.review.title');
  const write = usePreviewWrite();
  const [rejecting, setRejecting] = useState<ReviewDocument | null>(null);
  const [deviating, setDeviating] = useState<EvidenceGap | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // The control that acted is gone once the queue changes, so focus moves to the outcome.
  const announce = (message: string) => {
    setOutcome(message);
    returnFocusTo.current = status.current;
    window.requestAnimationFrame(() => {
      status.current?.focus();
    });
  };

  // Stable, so the gap grid keeps its columns (and the focused action) across renders.
  const openDeviation = useCallback((gap: EvidenceGap) => {
    returnFocusTo.current = null;
    setDeviating(gap);
  }, []);

  const describe = (document: ReviewDocument) => ({
    type: translate(document.evidenceType.label),
    supplier: document.supplier.name,
  });

  const confirm = (document: ReviewDocument) => {
    write?.(reviewQueueQuery, {}, withoutDocument(queue, document.documentId));
    announce(translate('pl.evidence.documents.confirmed', describe(document)));
  };

  const reject = (document: ReviewDocument) => {
    write?.(reviewQueueQuery, {}, withoutDocument(queue, document.documentId));
    returnFocusTo.current = status.current;
    setRejecting(null);
    announce(translate('pl.evidence.documents.rejected', describe(document)));
  };

  const recordDeviation = (gap: EvidenceGap, form: DeviationForm) => {
    write?.(
      reviewQueueQuery,
      {},
      withDeviation(queue, gapKey(gap), {
        deviationId: window.crypto.randomUUID(),
        reason: form.reason,
        recordedBy: translate('pl.evidence.deviation.previewRecorder'),
        recordedAt: new Date().toISOString(),
        expiresOn: form.expiresOn,
      }),
    );
    returnFocusTo.current = status.current;
    setDeviating(null);
    announce(
      translate('pl.evidence.deviation.recorded', {
        type: translate(gap.evidenceType.label),
        supplier: gap.supplier.name,
        date: formatDate(form.expiresOn),
      }),
    );
  };

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-line pb-4">
        <h1 className="text-2xl font-semibold">{translate('pl.evidence.review.title')}</h1>
        <p className="max-w-prose text-muted">{translate('pl.evidence.review.description')}</p>
        <p className="text-sm text-muted">{translate('pl.evidence.review.asOf', { date: formatDate(queue.asOf) })}</p>
      </div>
      <p ref={status} role="status" tabIndex={-1} className="text-sm font-medium text-success outline-hidden">
        {outcome}
      </p>
      <DocumentsSection
        queue={queue}
        canWrite={write !== null}
        onConfirm={confirm}
        onReject={(document) => {
          returnFocusTo.current = null;
          setRejecting(document);
        }}
        onPreviewOpen={() => {
          setOutcome(translate('pl.evidence.documents.viewPreview'));
        }}
      />
      <GapsSection queue={queue} canWrite={write !== null} onRecordDeviation={openDeviation} />
      <RejectDialog
        document={rejecting}
        returnFocusTo={returnFocusTo}
        onRejected={reject}
        onClose={() => {
          setRejecting(null);
        }}
      />
      <DeviationDialog
        gap={deviating}
        limits={queue}
        returnFocusTo={returnFocusTo}
        onRecorded={recordDeviation}
        onClose={() => {
          setDeviating(null);
        }}
      />
    </>
  );
}

function DocumentsSection({
  queue,
  canWrite,
  onConfirm,
  onReject,
  onPreviewOpen,
}: {
  queue: ReviewQueue;
  canWrite: boolean;
  onConfirm: (document: ReviewDocument) => void;
  onReject: (document: ReviewDocument) => void;
  onPreviewOpen: () => void;
}) {
  const translate = useTranslate();
  return (
    <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
      <h2 id="documents-heading" className="text-lg font-semibold">
        {translate('pl.evidence.documents.title', { count: queue.documents.length })}
      </h2>
      {queue.documents.length === 0 ? (
        <EmptyState
          headingLevel={3}
          titleKey="pl.evidence.documents.empty.title"
          descriptionKey="pl.evidence.documents.empty.description"
          action={
            <Link to="/suppliers" className={buttonVariants({ variant: 'secondary' })}>
              {translate('pl.evidence.documents.empty.action')}
            </Link>
          }
        />
      ) : (
        <ul aria-label={translate('pl.evidence.documents.label')} className="grid gap-3 xl:grid-cols-2">
          {queue.documents.map((document) => (
            <li key={document.documentId}>
              <DocumentCard
                document={document}
                canWrite={canWrite}
                onConfirm={onConfirm}
                onReject={onReject}
                onPreviewOpen={onPreviewOpen}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DocumentCard({
  document,
  canWrite,
  onConfirm,
  onReject,
  onPreviewOpen,
}: {
  document: ReviewDocument;
  canWrite: boolean;
  onConfirm: (document: ReviewDocument) => void;
  onReject: (document: ReviewDocument) => void;
  onPreviewOpen: () => void;
}) {
  const translate = useTranslate();
  const headingId = useId();
  const scanReasonId = useId();
  const names = { type: translate(document.evidenceType.label), supplier: document.supplier.name };
  const scanPending = document.scan === 'pending';
  const confirm = actionAvailability(document, 'confirm', canWrite, notYetAvailableKey);
  const reject = actionAvailability(document, 'reject', canWrite, notYetAvailableKey);
  const context = <span className="sr-only">{translate('pl.evidence.documents.actionContext', names)}</span>;
  return (
    <article
      aria-labelledby={headingId}
      className={cn('flex h-full flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-base font-semibold">
          {translate('pl.evidence.documents.heading', names)}
        </h3>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <StateBadge state={documentExpiryStates[document.expiry]} showLabel />
          <StateBadge state={scanStates[document.scan]} showLabel />
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 [&_dd]:font-medium [&_dt]:text-muted">
        <Fact label={translate('pl.evidence.documents.file')}>
          <span className="wrap-anywhere">
            {translate('pl.evidence.documents.fileSummary', {
              name: document.fileName,
              size: formatBytes(document.sizeBytes),
            })}
          </span>
        </Fact>
        <Fact label={translate('pl.evidence.documents.uploaded')}>
          {translate(
            document.uploadedBy.actorType === 'supplier_token'
              ? 'pl.evidence.documents.uploadedBySupplier'
              : 'pl.evidence.documents.uploadedByStaff',
            { name: document.uploadedBy.name, instant: formatInstantUtc(document.uploadedAt) },
          )}
        </Fact>
        <Fact label={translate('pl.evidence.documents.issued')}>
          {document.issuedOn === null ? translate('pl.evidence.documents.notStated') : formatDate(document.issuedOn)}
        </Fact>
        <Fact label={translate('pl.evidence.documents.validity')}>
          {document.validUntil === null
            ? translate('pl.evidence.documents.notStated')
            : translate(
                document.expiresOn === null
                  ? 'pl.evidence.documents.undatedValidUntil'
                  : 'pl.evidence.documents.validUntil',
                { date: formatDate(document.validUntil) },
              )}
        </Fact>
        <Fact label={translate('pl.evidence.documents.scope')}>
          {document.scope.map((category) => translate(`pl.parts.category.${category}`)).join(', ')}
        </Fact>
        <Fact label={translate('pl.evidence.documents.hash')}>
          <Mono title={document.contentHash}>{shortHash(document.contentHash)}</Mono>
        </Fact>
      </dl>
      {scanPending ? (
        <p id={scanReasonId} className="flex items-start gap-2 text-sm text-muted">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
          {translate('pl.evidence.blocked.scanPending')}
        </p>
      ) : null}
      <div
        role="group"
        aria-label={translate('pl.evidence.documents.actions', names)}
        className="mt-auto flex flex-wrap items-center gap-2"
      >
        <ViewAction document={document} reasonId={scanPending ? scanReasonId : undefined} onPreviewOpen={onPreviewOpen}>
          {context}
        </ViewAction>
        <ActionButton
          availability={confirm}
          variant="primary"
          size="sm"
          reasonId={sharedReason(confirm, scanPending, scanReasonId)}
          onAction={() => {
            onConfirm(document);
          }}
        >
          {translate('pl.evidence.documents.confirm')}
          {context}
        </ActionButton>
        <ActionButton
          availability={reject}
          size="sm"
          reasonId={sharedReason(reject, scanPending, scanReasonId)}
          onAction={() => {
            onReject(document);
          }}
        >
          {translate('pl.evidence.documents.reject')}
          {context}
        </ActionButton>
      </div>
    </article>
  );
}

/** While the scan is pending every action has the same reason, shown once for the card. */
function sharedReason(
  availability: ActionAvailability,
  scanPending: boolean,
  scanReasonId: string,
): string | undefined {
  return scanPending && availability.kind === 'blocked' ? scanReasonId : undefined;
}

/**
 * Opens the file through U14's audited download, which serves only files the scan found clean
 * (R12). The fixture preview has no files, so it says what would happen instead.
 */
function ViewAction({
  document,
  reasonId,
  onPreviewOpen,
  children,
}: {
  document: ReviewDocument;
  reasonId: string | undefined;
  onPreviewOpen: () => void;
  children: ReactNode;
}) {
  const translate = useTranslate();
  const adapterKind = useAdapterKind();
  const label = (
    <>
      <DownloadIcon aria-hidden />
      {translate('pl.evidence.documents.view')}
      {children}
    </>
  );
  if (reasonId !== undefined) {
    return (
      <ActionButton
        availability={{ kind: 'blocked', messageKey: 'pl.evidence.blocked.scanPending', params: {} }}
        size="sm"
        reasonId={reasonId}
        onAction={onPreviewOpen}
      >
        {label}
      </ActionButton>
    );
  }
  if (adapterKind === 'http') {
    return (
      <a
        href={evidenceDownloadPath(document.documentId)}
        className={buttonVariants({ variant: 'secondary', size: 'sm' })}
      >
        {label}
      </a>
    );
  }
  return (
    <Button variant="secondary" size="sm" onClick={onPreviewOpen}>
      {label}
    </Button>
  );
}

const gapHelper = createGridColumnHelper<EvidenceGap>();

function GapsSection({
  queue,
  canWrite,
  onRecordDeviation,
}: {
  queue: ReviewQueue;
  canWrite: boolean;
  onRecordDeviation: (gap: EvidenceGap) => void;
}) {
  const translate = useTranslate();
  const columns = useMemo(
    () =>
      gapHelper.columns([
        gapHelper.accessor((gap) => gap.supplier.name, {
          id: 'supplier',
          header: () => translate('pl.evidence.gaps.column.supplier'),
        }),
        gapHelper.accessor((gap) => translate(gap.evidenceType.label), {
          id: 'type',
          header: () => translate('pl.evidence.gaps.column.type'),
        }),
        gapHelper.accessor('problem', {
          header: () => translate('pl.evidence.gaps.column.problem'),
          cell: ({ getValue }) => <StateBadge state={problemStates[getValue()]} showLabel />,
        }),
        gapHelper.accessor((gap) => gap.since ?? '', {
          id: 'since',
          header: () => translate('pl.evidence.gaps.column.since'),
          cell: ({ row }) =>
            row.original.since === null ? (
              <span className="text-muted">{translate('pl.evidence.gaps.noDate')}</span>
            ) : (
              <Mono>{formatDate(row.original.since)}</Mono>
            ),
        }),
        gapHelper.accessor((gap) => gap.deviation?.expiresOn ?? '', {
          id: 'deviation',
          header: () => translate('pl.evidence.gaps.column.deviation'),
          cell: ({ row }) => {
            const deviation = row.original.deviation;
            return deviation === null ? (
              <StateBadge state={deviationStates.none} showLabel className="text-muted" />
            ) : (
              <span className="inline-flex items-center gap-2">
                <StateBadge state={deviationStates.active} showLabel />
                <Mono>{translate('pl.evidence.gaps.coveredUntil', { date: formatDate(deviation.expiresOn) })}</Mono>
              </span>
            );
          },
        }),
        gapHelper.display({
          id: 'action',
          header: () => translate('pl.evidence.gaps.column.action'),
          cell: ({ row }) => {
            const availability = actionAvailability(row.original, 'recordDeviation', canWrite, notYetAvailableKey);
            return (
              <ActionButton
                availability={availability}
                // The deviation column already shows why a covered gap takes no second deviation.
                reasonHidden={availability.kind === 'blocked'}
                size="sm"
                onAction={() => {
                  onRecordDeviation(row.original);
                }}
              >
                {translate('pl.evidence.gaps.record')}
                <span className="sr-only">
                  {translate('pl.evidence.gaps.recordContext', {
                    type: translate(row.original.evidenceType.label),
                    supplier: row.original.supplier.name,
                  })}
                </span>
              </ActionButton>
            );
          },
        }),
      ]),
    [translate, canWrite, onRecordDeviation],
  );
  return (
    <section aria-labelledby="gaps-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="gaps-heading" className="text-lg font-semibold">
          {translate('pl.evidence.gaps.title')}
        </h2>
        <p className="max-w-prose text-sm text-muted">{translate('pl.evidence.gaps.description')}</p>
      </div>
      {queue.gaps.length === 0 ? (
        <EmptyState
          headingLevel={3}
          titleKey="pl.evidence.gaps.empty.title"
          descriptionKey="pl.evidence.gaps.empty.description"
          action={
            <Link to="/suppliers" className={buttonVariants({ variant: 'secondary' })}>
              {translate('pl.evidence.gaps.empty.action')}
            </Link>
          }
        />
      ) : (
        <DataGrid
          label={translate('pl.evidence.gaps.gridLabel')}
          data={queue.gaps}
          columns={columns}
          getRowId={gapKey}
        />
      )}
    </section>
  );
}
