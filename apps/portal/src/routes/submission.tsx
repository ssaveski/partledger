import { portalSubmissionQuery, type PortalSubmission, type SubmissionRead } from '@partledger/contracts/portal';
import { cn, EmptyState, Mono, raisedSurface, useTranslate } from '@partledger/ui';
import { LockIcon } from 'lucide-react';

import { useApiQuery } from '../api/connection';
import { useDocumentTitle } from '../shell/document-title';
import { formatInstantIn, formatInstantUtc } from '../shell/format';
import { QueryView } from '../shell/query-view';
import { usePortalSession } from '../shell/session-layout';
import { AnswerKindBadge, AnswerSummary } from './answer-summary';
import { ChangedLineNotice, LineFacts, LineTitle } from './line-parts';

export function SubmissionScreen() {
  const query = useApiQuery(portalSubmissionQuery, {});
  return (
    <QueryView query={query} titleKey="pl.portal.submission.title" loadingKey="pl.portal.submission.loading">
      {(read) => <SubmissionView read={read} />}
    </QueryView>
  );
}

/** The last submission as the buyer received it, read-only: after close it can no longer change (AE11). */
function SubmissionView({ read }: { read: SubmissionRead }) {
  const translate = useTranslate();
  useDocumentTitle('pl.portal.submission.documentTitle', { reference: read.reference });
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {translate('pl.portal.submission.title')}
        <span className="block text-base font-normal text-muted">
          {translate('pl.portal.respond.subtitle', { reference: read.reference, title: read.title })}
        </span>
      </h1>
      {read.availability === 'notSubmitted' ? (
        <EmptyState
          headingLevel={2}
          titleKey="pl.portal.submission.none.title"
          descriptionKey={
            read.rfqState === 'open'
              ? 'pl.portal.submission.none.descriptionOpen'
              : 'pl.portal.submission.none.descriptionClosed'
          }
          action={null}
        />
      ) : (
        <Submitted submission={read} />
      )}
    </>
  );
}

function Submitted({ submission }: { submission: PortalSubmission }) {
  const translate = useTranslate();
  const session = usePortalSession();
  return (
    <>
      <p className="flex max-w-prose items-start gap-2 text-sm text-muted">
        <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        {translate(
          submission.rfqState === 'open' ? 'pl.portal.submission.readOnlyOpen' : 'pl.portal.submission.readOnlyClosed',
        )}
      </p>
      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm [&_dd]:font-medium [&_dt]:text-muted">
        <div className="flex flex-col gap-0.5">
          <dt>{translate('pl.portal.submission.submittedAt')}</dt>
          <dd className="flex flex-col">
            <time dateTime={submission.submittedAt}>{formatInstantIn(submission.submittedAt, session.timeZone)}</time>
            <Mono className="font-normal text-muted">
              {translate('pl.portal.format.utc', { instant: formatInstantUtc(submission.submittedAt) })}
            </Mono>
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt>{translate('pl.portal.submission.version')}</dt>
          <dd>
            {translate('pl.portal.submission.versionValue', {
              submission: submission.submissionVersion,
              rfqVersion: submission.rfqVersion,
            })}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt>{translate('pl.portal.submission.declaredName')}</dt>
          <dd>{submission.declaredName}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt>{translate('pl.portal.submission.attestation')}</dt>
          <dd>{translate('pl.portal.submission.attested', { supplier: session.supplierName })}</dd>
        </div>
      </dl>
      <section aria-labelledby="submitted-lines" className="flex flex-col gap-3">
        <h2 id="submitted-lines" className="text-lg font-semibold">
          {translate('pl.portal.submission.linesTitle')}
        </h2>
        <ul className="flex flex-col gap-3">
          {submission.lines.map((line) => (
            <li key={line.lineId}>
              <article
                aria-labelledby={`line-${line.lineId}`}
                className={cn(
                  'flex flex-col gap-3 rounded-lg border p-4',
                  line.changedSince ? 'border-warning' : 'border-line',
                  raisedSurface,
                )}
              >
                <h3 id={`line-${line.lineId}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <LineTitle line={line} />
                  <AnswerKindBadge kind={line.answer.kind} />
                </h3>
                <LineFacts line={line} />
                {line.changedSince ? (
                  <ChangedLineNotice
                    id={`change-${line.lineId}`}
                    change={null}
                    timeZone={session.timeZone}
                    canResubmit={submission.rfqState === 'open'}
                  />
                ) : null}
                <AnswerSummary answer={line.answer} unit={line.unit} />
              </article>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
