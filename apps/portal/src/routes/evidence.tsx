import {
  portalEvidenceRequestsQuery,
  type EvidenceRequest,
  type EvidenceRequestList,
} from '@partledger/contracts/portal';
import {
  Button,
  cn,
  EmptyState,
  Mono,
  raisedSurface,
  StateBadge,
  useTranslate,
  type GridStateDefinition,
} from '@partledger/ui';
import { CircleCheckIcon, CircleXIcon, FileClockIcon, FileUpIcon } from 'lucide-react';
import { useId } from 'react';

import { useApiQuery } from '../api/connection';
import { useDocumentTitle } from '../shell/document-title';
import { formatDate, formatInstantIn } from '../shell/format';
import { QueryView } from '../shell/query-view';
import { usePortalSession } from '../shell/session-layout';

const statusStates: Readonly<Record<EvidenceRequest['status'], GridStateDefinition>> = {
  requested: { id: 'requested', labelKey: 'pl.portal.evidence.status.requested', tone: 'warning', icon: FileUpIcon },
  underReview: {
    id: 'underReview',
    labelKey: 'pl.portal.evidence.status.underReview',
    tone: 'info',
    icon: FileClockIcon,
  },
  accepted: { id: 'accepted', labelKey: 'pl.portal.evidence.status.accepted', tone: 'success', icon: CircleCheckIcon },
  rejected: { id: 'rejected', labelKey: 'pl.portal.evidence.status.rejected', tone: 'danger', icon: CircleXIcon },
};

export function EvidenceScreen() {
  const query = useApiQuery(portalEvidenceRequestsQuery, {});
  return (
    <QueryView query={query} titleKey="pl.portal.evidence.title" loadingKey="pl.portal.evidence.loading">
      {(list) => <EvidenceList list={list} />}
    </QueryView>
  );
}

/** The documents a buyer asked this supplier for, each with what the supplier needs to do next. */
function EvidenceList({ list }: { list: EvidenceRequestList }) {
  const translate = useTranslate();
  useDocumentTitle('pl.portal.evidence.title');
  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{translate('pl.portal.evidence.title')}</h1>
        <p className="max-w-prose text-sm text-muted">
          {translate('pl.portal.evidence.intro', { buyer: list.buyerName })}
        </p>
      </div>
      {list.requests.length === 0 ? (
        <EmptyState
          titleKey="pl.portal.evidence.empty.title"
          descriptionKey="pl.portal.evidence.empty.description"
          action={null}
        />
      ) : (
        <ul className="flex flex-col gap-3" aria-label={translate('pl.portal.evidence.listLabel')}>
          {list.requests.map((request) => (
            <li key={request.requestId}>
              <RequestCard request={request} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RequestCard({ request }: { request: EvidenceRequest }) {
  const translate = useTranslate();
  const session = usePortalSession();
  const headingId = useId();
  const uploadReasonId = useId();
  const needsUpload = request.status === 'requested' || request.status === 'rejected';
  const typeName = translate(request.typeLabel);
  return (
    <article
      aria-labelledby={headingId}
      className={cn('flex flex-col gap-3 rounded-lg border border-line p-4', raisedSurface)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-base font-semibold">
          {typeName}
        </h2>
        <StateBadge state={statusStates[request.status]} showLabel />
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm [&_dd]:font-medium [&_dt]:text-muted">
        <div className="flex flex-col gap-0.5">
          <dt>{translate('pl.portal.evidence.dueBy')}</dt>
          <dd>
            <Mono>{formatDate(request.dueBy)}</Mono>
          </dd>
        </div>
        {request.uploadedAt === null ? null : (
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.evidence.uploadedAt')}</dt>
            <dd>{formatInstantIn(request.uploadedAt, session.timeZone)}</dd>
          </div>
        )}
        {request.validUntil === null ? null : (
          <div className="flex flex-col gap-0.5">
            <dt>{translate('pl.portal.evidence.validUntil')}</dt>
            <dd>
              <Mono>{formatDate(request.validUntil)}</Mono>
            </dd>
          </div>
        )}
      </dl>
      {request.rejectionReason === null ? null : (
        <p className="rounded-md border border-danger bg-surface-sunken px-3 py-2 text-sm">
          <strong className="font-semibold">{translate('pl.portal.evidence.rejectionReason')}</strong>{' '}
          {request.rejectionReason}
        </p>
      )}
      <p className="text-sm text-muted">{translate(`pl.portal.evidence.next.${request.status}`)}</p>
      {needsUpload ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* U31 adds uploads through the scanned upload pipeline; until then the action says so. */}
          <Button variant="secondary" disabled focusableWhenDisabled aria-describedby={uploadReasonId}>
            <FileUpIcon aria-hidden />
            {translate('pl.portal.evidence.upload')}
            <span className="sr-only">{translate('pl.portal.evidence.uploadContext', { type: typeName })}</span>
          </Button>
          <p id={uploadReasonId} className="text-sm text-muted">
            {translate('pl.portal.evidence.uploadUnavailable')}
          </p>
        </div>
      ) : null}
    </article>
  );
}
