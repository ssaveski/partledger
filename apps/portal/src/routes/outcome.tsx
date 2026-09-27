import { portalOutcomeQuery, type OutcomeLine, type PortalOutcome } from '@partledger/contracts/portal';
import { cn, raisedSurface, StateBadge, useTranslate, type GridStateDefinition } from '@partledger/ui';
import { AwardIcon, CircleMinusIcon, EyeOffIcon } from 'lucide-react';

import { useApiQuery } from '../api/connection';
import { useDocumentTitle } from '../shell/document-title';
import { formatInstantIn } from '../shell/format';
import { QueryView } from '../shell/query-view';
import { usePortalSession } from '../shell/session-layout';
import { LineFacts, LineTitle } from './line-parts';

const resultStates: Readonly<Record<OutcomeLine['result'], GridStateDefinition>> = {
  awarded: { id: 'awarded', labelKey: 'pl.portal.outcome.result.awarded', tone: 'success', icon: AwardIcon },
  notAwarded: {
    id: 'notAwarded',
    labelKey: 'pl.portal.outcome.result.notAwarded',
    tone: 'neutral',
    icon: CircleMinusIcon,
  },
};

export function OutcomeScreen() {
  const query = useApiQuery(portalOutcomeQuery, {});
  return (
    <QueryView query={query} titleKey="pl.portal.outcome.title" loadingKey="pl.portal.outcome.loading">
      {(outcome) => <OutcomeView outcome={outcome} />}
    </QueryView>
  );
}

/**
 * The sealed result of this supplier's own lines (R20): whether each was awarded to it, and
 * nothing about who won otherwise, at what price, or who else answered.
 */
function OutcomeView({ outcome }: { outcome: PortalOutcome }) {
  const translate = useTranslate();
  const session = usePortalSession();
  useDocumentTitle('pl.portal.outcome.documentTitle', { reference: outcome.reference });
  const awarded = outcome.lines.filter((line) => line.result === 'awarded').length;
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {translate('pl.portal.outcome.title')}
        <span className="block text-base font-normal text-muted">
          {translate('pl.portal.respond.subtitle', { reference: outcome.reference, title: outcome.title })}
        </span>
      </h1>
      <p className="max-w-prose">
        {translate('pl.portal.outcome.summary', {
          awarded,
          total: outcome.lines.length,
          sealedAt: formatInstantIn(outcome.sealedAt, session.timeZone),
        })}
      </p>
      <p className="flex max-w-prose items-start gap-2 text-sm text-muted">
        <EyeOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        {translate('pl.portal.outcome.ownLinesOnly')}
      </p>
      <section aria-labelledby="outcome-lines" className="flex flex-col gap-3">
        <h2 id="outcome-lines" className="text-lg font-semibold">
          {translate('pl.portal.outcome.linesTitle')}
        </h2>
        <ul className="flex flex-col gap-3">
          {outcome.lines.map((line) => (
            <li
              key={line.lineId}
              className={cn(
                'flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line p-4',
                raisedSurface,
              )}
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-semibold">
                  <LineTitle line={line} />
                </p>
                <LineFacts line={line} />
              </div>
              <StateBadge state={resultStates[line.result]} showLabel />
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-sm text-muted">{translate('pl.portal.outcome.nextStep')}</p>
      </section>
    </>
  );
}
