import { Mono, useTranslate } from '@partledger/ui';
import { HistoryIcon } from 'lucide-react';

import { formatDate, formatInstantIn, formatNumber } from '../shell/format';

interface LinePart {
  readonly lineNumber: number;
  readonly partNumber: string;
  readonly revision: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
}

/** "Line 3 · PN-20877 rev B · Drive shaft", the name of a line on every portal screen. */
export function LineTitle({ line }: { line: LinePart }) {
  const translate = useTranslate();
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{translate('pl.portal.line.label', { line: line.lineNumber })}</span>
      <Mono className="font-normal text-muted">
        {translate('pl.portal.line.part', { part: line.partNumber, revision: line.revision })}
      </Mono>
      <span className="font-normal text-muted">{line.description}</span>
    </span>
  );
}

export function quantityLabel(translate: ReturnType<typeof useTranslate>, quantity: number, unit: string): string {
  return translate(`pl.portal.quantity.${unit}`, { quantity: formatNumber(quantity) });
}

export function LineFacts({ line, requiredBy }: { line: LinePart; requiredBy?: string }) {
  const translate = useTranslate();
  return (
    <p className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
      <span>
        {translate('pl.portal.line.quantity')}{' '}
        <Mono className="text-primary">{quantityLabel(translate, line.quantity, line.unit)}</Mono>
      </span>
      {requiredBy === undefined ? null : (
        <span>
          {translate('pl.portal.line.requiredBy')} <Mono className="text-primary">{formatDate(requiredBy)}</Mono>
        </span>
      )}
    </p>
  );
}

/**
 * A line the buyer changed after the supplier last submitted (R16). It is its own indicator,
 * separate from the draft-saved status, because saving a draft does not resubmit the line. While
 * the request is open it asks for a resubmission; after close it only says the answer is to the
 * earlier version, since nothing can be resubmitted any more.
 */
export function ChangedLineNotice({
  id,
  change,
  timeZone,
  canResubmit,
}: {
  id: string;
  change: { version: number; changedAt: string } | null;
  timeZone: string;
  canResubmit: boolean;
}) {
  const translate = useTranslate();
  return (
    <div
      id={id}
      className="flex items-start gap-2 rounded-md border border-warning bg-surface-sunken px-3 py-2 text-sm text-primary"
    >
      <HistoryIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <p className="flex flex-col gap-0.5">
        <strong className="font-semibold">
          {translate(canResubmit ? 'pl.portal.line.changed' : 'pl.portal.line.changedAfterSubmission')}
        </strong>
        {change === null ? null : (
          <span className="text-muted">
            {translate('pl.portal.line.changedDetail', {
              version: change.version,
              changedAt: formatInstantIn(change.changedAt, timeZone),
            })}
          </span>
        )}
      </p>
    </div>
  );
}
