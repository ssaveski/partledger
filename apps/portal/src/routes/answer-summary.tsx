import type { LineAnswer } from '@partledger/contracts/portal';
import { Badge, Mono, useTranslate, type StateTone } from '@partledger/ui';
import type { ReactNode } from 'react';

import { formatDate, formatMoney, formatNumber } from '../shell/format';
import { quantityLabel } from './line-parts';

const kindTones: Readonly<Record<LineAnswer['kind'], StateTone>> = {
  quote: 'info',
  noQuote: 'neutral',
  alternate: 'accent',
};

export function AnswerKindBadge({ kind }: { kind: LineAnswer['kind'] }) {
  const translate = useTranslate();
  return <Badge tone={kindTones[kind]}>{translate(`pl.portal.answer.kind.${kind}`)}</Badge>;
}

/** A submitted answer as text only, with no control that could suggest it can still be changed. */
export function AnswerSummary({ answer, unit }: { answer: LineAnswer; unit: string }) {
  const translate = useTranslate();
  if (answer.kind === 'noQuote') {
    return (
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 [&_dd]:font-medium [&_dt]:text-muted">
        <Fact label={translate('pl.portal.answer.noQuoteReason')}>
          {translate(`pl.portal.noQuoteReason.${answer.reason}`)}
        </Fact>
        {answer.note === null ? null : <Fact label={translate('pl.portal.answer.noQuoteNote')}>{answer.note}</Fact>}
      </dl>
    );
  }
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 [&_dd]:font-medium [&_dt]:text-muted">
      {answer.kind === 'alternate' ? (
        <Fact label={translate('pl.portal.answer.specification')} wide>
          {answer.specification}
        </Fact>
      ) : null}
      <Fact label={translate('pl.portal.answer.unitPrices')} wide>
        <ul className="flex flex-col gap-0.5">
          {answer.priceBreaks.map((priceBreak) => (
            <li key={priceBreak.quantity}>
              <Mono>
                {translate('pl.portal.answer.priceAtBreak', {
                  quantity: quantityLabel(translate, priceBreak.quantity, unit),
                  price: formatMoney({ amount: priceBreak.unitPrice, currency: answer.currency }),
                })}
              </Mono>
            </li>
          ))}
        </ul>
      </Fact>
      <Fact label={translate('pl.portal.answer.oneOffCosts')}>
        <Mono>{formatMoney({ amount: answer.oneOffCosts, currency: answer.currency })}</Mono>
      </Fact>
      <Fact label={translate('pl.portal.answer.minimumOrderQuantity')}>
        <Mono>{formatNumber(answer.minimumOrderQuantity)}</Mono>
      </Fact>
      <Fact label={translate('pl.portal.answer.leadTime')}>
        <Mono>{translate('pl.portal.answer.leadTimeDays', { days: answer.leadTimeDays })}</Mono>
      </Fact>
      <Fact label={translate('pl.portal.answer.validUntil')}>
        <Mono>{formatDate(answer.validUntil)}</Mono>
      </Fact>
    </dl>
  );
}

function Fact({ label, wide = false, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'flex flex-col gap-0.5 sm:col-span-2' : 'flex flex-col gap-0.5'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
