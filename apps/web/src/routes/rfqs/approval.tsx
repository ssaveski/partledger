import {
  approvalPacketQuery,
  type ApprovalPacket,
  type ApprovalRead,
  type AwardDecision,
  type GateCheck,
} from '@partledger/contracts';
import {
  Button,
  buttonVariants,
  Card,
  CardTitle,
  cn,
  EmptyState,
  Mono,
  StateBadge,
  useTranslate,
  type GridStateDefinition,
} from '@partledger/ui';
import { getRouteApi, Link } from '@tanstack/react-router';
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleXIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  ShieldEllipsisIcon,
  ShieldQuestionIcon,
  ShieldXIcon,
  TrendingDownIcon,
} from 'lucide-react';
import { useId, useState } from 'react';

import { useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatDate, formatInstantUtc, formatMoney, formatNumber, messageParams, shortHash } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { buyerRecordedMarker } from './comparison-states';
import { Fact, RfqHeader } from './rfq-header';

const route = getRouteApi('/rfqs/$rfqId/approval');

const gateStates: Readonly<Record<'passed' | 'blocked', GridStateDefinition>> = {
  passed: { id: 'gatePassed', labelKey: 'pl.rfqs.approval.check.passed', tone: 'success', icon: CircleCheckIcon },
  blocked: { id: 'gateBlocked', labelKey: 'pl.rfqs.approval.check.blocked', tone: 'danger', icon: CircleXIcon },
};

type DocumentStatus = AwardDecision['evidence'][number]['status'];

const documentStates: Readonly<Record<DocumentStatus, GridStateDefinition>> = {
  valid: { id: 'documentValid', labelKey: 'pl.rfqs.document.valid', tone: 'success', icon: ShieldCheckIcon },
  expiring: { id: 'documentExpiring', labelKey: 'pl.rfqs.document.expiring', tone: 'warning', icon: ShieldAlertIcon },
  expired: { id: 'documentExpired', labelKey: 'pl.rfqs.document.expired', tone: 'danger', icon: ShieldXIcon },
  missing: { id: 'documentMissing', labelKey: 'pl.rfqs.document.missing', tone: 'danger', icon: ShieldQuestionIcon },
  coveredByDeviation: {
    id: 'documentCoveredByDeviation',
    labelKey: 'pl.rfqs.document.coveredByDeviation',
    tone: 'info',
    icon: ShieldEllipsisIcon,
  },
};

const lowestMarker: GridStateDefinition = {
  id: 'lowest',
  labelKey: 'pl.rfqs.approval.lowest',
  tone: 'success',
  icon: TrendingDownIcon,
};

const deviationMarker: GridStateDefinition = {
  id: 'deviation',
  labelKey: 'pl.rfqs.approval.deviation.title',
  tone: 'info',
  icon: BadgeCheckIcon,
};

export function ApprovalScreen() {
  const { rfqId } = route.useParams();
  const query = useApiQuery(approvalPacketQuery, { rfqId });
  return (
    <QueryView query={query} titleKey="pl.rfqs.approval.title" loadingKey="pl.rfqs.approval.loading">
      {(packet) =>
        packet.availability === 'submitted' ? <ApprovalView packet={packet} /> : <NoAwardSubmitted packet={packet} />
      }
    </QueryView>
  );
}

function NoAwardSubmitted({ packet }: { packet: Extract<ApprovalRead, { availability: 'noAwardSubmitted' }> }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.approval.documentTitle', { reference: packet.reference });
  return (
    <>
      <RfqHeader
        rfqId={packet.rfqId}
        reference={packet.reference}
        title={packet.title}
        status={packet.status}
        screenKey="pl.rfqs.approval.title"
      />
      <EmptyState
        titleKey="pl.rfqs.approval.empty.title"
        descriptionKey="pl.rfqs.approval.empty.description"
        action={
          <Link
            to="/rfqs/$rfqId/comparison"
            params={{ rfqId: packet.rfqId }}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {translate('pl.rfqs.approval.empty.action')}
          </Link>
        }
      />
    </>
  );
}

function ApprovalView({ packet }: { packet: ApprovalPacket }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.approval.documentTitle', { reference: packet.reference });
  return (
    <>
      <RfqHeader
        rfqId={packet.rfqId}
        reference={packet.reference}
        title={packet.title}
        status={packet.status}
        screenKey="pl.rfqs.approval.title"
      >
        <Fact label={translate('pl.rfqs.approval.awardVersion')}>
          <Mono>{formatNumber(packet.awardVersion)}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.approval.submittedBy')}>{packet.submittedBy}</Fact>
        <Fact label={translate('pl.rfqs.approval.submittedAt')}>
          <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(packet.submittedAt) })}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.approval.awardedTotal')}>
          <Mono>{formatMoney(packet.awardedTotal)}</Mono>
        </Fact>
      </RfqHeader>
      <ApprovalActions packet={packet} />
      <GateChecklist packet={packet} />
      <section aria-labelledby="decisions-heading" className="flex flex-col gap-3">
        <h2 id="decisions-heading" className="text-lg font-semibold">
          {translate('pl.rfqs.approval.decisions.title')}
        </h2>
        <ul className="grid gap-3 lg:grid-cols-2">
          {packet.decisions.map((decision) => (
            <li key={decision.lineId}>
              <DecisionCard decision={decision} />
            </li>
          ))}
        </ul>
      </section>
      {packet.previousRound === null ? null : <PreviousRound previousRound={packet.previousRound} />}
    </>
  );
}

/**
 * Approve and reject, each disabled with the server's reason when it is not allowed. Disabled
 * actions stay focusable, so a keyboard user reaches the reason through the action itself.
 */
function ApprovalActions({ packet }: { packet: ApprovalPacket }) {
  const translate = useTranslate();
  const [outcome, setOutcome] = useState<'approve' | 'reject' | null>(null);
  return (
    <section aria-labelledby="actions-heading" className="flex flex-col gap-2">
      <h2 id="actions-heading" className="sr-only">
        {translate('pl.rfqs.approval.actions.title')}
      </h2>
      <div className="flex flex-wrap items-start gap-3">
        {(['approve', 'reject'] as const).map((transition) => (
          <ApprovalAction
            key={transition}
            packet={packet}
            transition={transition}
            onChoose={() => {
              setOutcome(transition);
            }}
          />
        ))}
      </div>
      <p role="status" className="text-sm font-medium text-success">
        {outcome === null ? null : translate(`pl.rfqs.approval.${outcome}Preview`)}
      </p>
    </section>
  );
}

function ApprovalAction({
  packet,
  transition,
  onChoose,
}: {
  packet: ApprovalPacket;
  transition: 'approve' | 'reject';
  onChoose: () => void;
}) {
  const translate = useTranslate();
  const reasonId = useId();
  const allowed = packet.allowedTransitions.includes(transition);
  const blocked = packet.blockingReasons.find((reason) => reason.transition === transition);
  return (
    <div className="flex max-w-sm flex-col items-start gap-1">
      <Button
        variant={transition === 'approve' ? 'primary' : 'secondary'}
        disabled={!allowed}
        focusableWhenDisabled
        aria-describedby={allowed ? undefined : reasonId}
        onClick={onChoose}
      >
        {translate(`pl.rfqs.approval.${transition}`)}
      </Button>
      {allowed ? null : (
        <p id={reasonId} className="text-sm text-muted">
          {blocked === undefined
            ? translate('pl.rfqs.blocked.notAvailable')
            : translate(blocked.message, messageParams(blocked.params))}
        </p>
      )}
    </div>
  );
}

function GateChecklist({ packet }: { packet: ApprovalPacket }) {
  const translate = useTranslate();
  const blockedCount = packet.gate.checks.filter((check) => !check.passed).length;
  return (
    <section aria-labelledby="gate-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="gate-heading" className="text-lg font-semibold">
          {translate('pl.rfqs.approval.gate.title')}
        </h2>
        <p className={cn('text-sm font-medium', packet.gate.passed ? 'text-success' : 'text-danger')}>
          {packet.gate.passed
            ? translate('pl.rfqs.approval.gate.passed')
            : translate('pl.rfqs.approval.gate.blocked', { count: blockedCount })}
        </p>
        <p className="text-sm text-muted">
          {translate('pl.rfqs.approval.gate.checkedAt', {
            instant: translate('pl.web.format.utc', { instant: formatInstantUtc(packet.gate.checkedAt) }),
          })}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {packet.gate.checks.map((check) => (
          <GateCheckItem key={check.check} check={check} />
        ))}
      </ul>
    </section>
  );
}

function GateCheckItem({ check }: { check: GateCheck }) {
  const translate = useTranslate();
  return (
    <li
      data-gate-check={check.check}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        check.passed ? 'border-line' : 'border-danger',
      )}
    >
      <StateBadge state={gateStates[check.passed ? 'passed' : 'blocked']} className="mt-0.5" />
      <span className="flex flex-col">
        <span className="font-medium">{translate(`pl.rfqs.approval.check.${check.check}`)}</span>
        <span className={check.passed ? 'text-muted' : 'text-primary'}>
          {translate(check.message, messageParams(check.params))}
        </span>
      </span>
    </li>
  );
}

function DecisionCard({ decision }: { decision: AwardDecision }) {
  const translate = useTranslate();
  return (
    <Card className="h-full gap-3 p-4">
      <CardTitle headingLevel={3} className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span>{translate('pl.rfqs.comparison.lineLabel', { line: decision.lineNumber })}</span>
        <Mono className="font-normal text-muted">
          {translate('pl.rfqs.comparison.partLabel', { part: decision.partNumber, revision: decision.revision })}
        </Mono>
        <span className="font-normal text-muted">{decision.description}</span>
      </CardTitle>
      {decision.supplier === null || decision.normalisedTotal === null ? (
        <p className="text-sm font-medium">{translate('pl.rfqs.approval.noAward')}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{decision.supplier.name}</span>
            <Mono>{formatMoney(decision.normalisedTotal)}</Mono>
            {decision.lowest ? <StateBadge state={lowestMarker} showLabel /> : null}
            {decision.buyerRecorded ? <StateBadge state={buyerRecordedMarker} showLabel /> : null}
          </p>
          {decision.justification === null ? null : (
            <div className="flex flex-col gap-0.5 text-sm">
              <p className="text-muted">{translate('pl.rfqs.approval.justification')}</p>
              <p>{decision.justification}</p>
            </div>
          )}
          <EvidenceList decision={decision} />
          {decision.deviation === null ? null : (
            <div className="flex flex-col gap-1 rounded-md border border-info px-3 py-2 text-sm">
              <StateBadge state={deviationMarker} showLabel className="font-medium" />
              <p>
                {translate('pl.rfqs.approval.deviation.covers', {
                  document: translate(decision.deviation.typeLabel),
                  expiresOn: formatDate(decision.deviation.expiresOn),
                })}
              </p>
              <p>{decision.deviation.reason}</p>
              <p className="text-muted">
                {translate('pl.rfqs.approval.deviation.recordedBy', { person: decision.deviation.recordedBy })}
              </p>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function EvidenceList({ decision }: { decision: AwardDecision }) {
  const translate = useTranslate();
  if (decision.evidence.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-muted">{translate('pl.rfqs.approval.evidence')}</p>
      <ul className="flex flex-col gap-1">
        {decision.evidence.map((document) => (
          <li key={document.documentId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{translate(document.typeLabel)}</span>
            <StateBadge state={documentStates[document.status]} showLabel />
            {document.expiresOn === null ? null : (
              <span className="text-muted">
                {translate(
                  document.status === 'expired' ? 'pl.rfqs.approval.expiredOn' : 'pl.rfqs.approval.expiresOn',
                  {
                    date: formatDate(document.expiresOn),
                  },
                )}
              </span>
            )}
            {document.contentHash === null ? null : (
              <Mono className="text-xs text-muted">
                {translate('pl.rfqs.approval.contentHash', { hash: shortHash(document.contentHash) })}
              </Mono>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PreviousRound({ previousRound }: { previousRound: NonNullable<ApprovalPacket['previousRound']> }) {
  const translate = useTranslate();
  return (
    <section aria-labelledby="previous-round-heading" className="flex flex-col gap-3">
      <h2 id="previous-round-heading" className="text-lg font-semibold">
        {translate('pl.rfqs.approval.previousRound.title')}
      </h2>
      <Card className="gap-2 p-4 text-sm">
        <dl className="flex flex-wrap gap-x-8 gap-y-2 [&_dd]:font-medium [&_dt]:text-muted">
          <Fact label={translate('pl.rfqs.approval.previousRound.reference')}>
            <Mono>{previousRound.reference}</Mono>
          </Fact>
          <Fact label={translate('pl.rfqs.approval.previousRound.closedAt')}>
            <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(previousRound.closedAt) })}</Mono>
          </Fact>
          <Fact label={translate('pl.rfqs.approval.previousRound.suppliersInvited')}>
            <Mono>{formatNumber(previousRound.suppliersInvited)}</Mono>
          </Fact>
          <Fact label={translate('pl.rfqs.approval.previousRound.quotesReceived')}>
            <Mono>{formatNumber(previousRound.quotesReceived)}</Mono>
          </Fact>
        </dl>
        <p className="text-muted">{translate('pl.rfqs.approval.previousRound.reason')}</p>
        <p>{previousRound.rebidReason}</p>
      </Card>
    </section>
  );
}
