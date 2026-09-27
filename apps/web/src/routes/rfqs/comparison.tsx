import { quoteComparisonQuery, type ComparisonRead, type QuoteComparison } from '@partledger/contracts';
import type { ClientResult } from '@partledger/contracts/client';
import { buttonVariants, EmptyState, GridLegend, Mono, useTranslate } from '@partledger/ui';
import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { InfoIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import { queryKeyOf, useApiQuery } from '../../api/api-client';
import { useDocumentTitle } from '../../shell/document-title';
import { formatInstantUtc, formatNumber } from '../../shell/format';
import { QueryView } from '../../shell/query-view';
import { AwardDecisions } from './award-decisions';
import { ComparisonGrid, type OutsideQuoteTarget } from './comparison-grid';
import { buyerRecordedMarker, cellStates } from './comparison-states';
import { OutsideQuoteDialog } from './outside-quote-dialog';
import { withOutsideQuote, type OutsideQuote } from './outside-quote';
import { Fact, RfqHeader } from './rfq-header';

const route = getRouteApi('/rfqs/$rfqId/comparison');

const legendStates = [...Object.values(cellStates), buyerRecordedMarker];

export function ComparisonScreen() {
  const { rfqId } = route.useParams();
  const query = useApiQuery(quoteComparisonQuery, { rfqId });
  return (
    <QueryView query={query} titleKey="pl.rfqs.comparison.title" loadingKey="pl.rfqs.comparison.loading">
      {(comparison) =>
        comparison.availability === 'available' ? (
          <ComparisonView comparison={comparison} />
        ) : (
          <NotYetClosed comparison={comparison} />
        )
      }
    </QueryView>
  );
}

function NotYetClosed({ comparison }: { comparison: Extract<ComparisonRead, { availability: 'notYetClosed' }> }) {
  const translate = useTranslate();
  useDocumentTitle('pl.rfqs.comparison.documentTitle', { reference: comparison.reference });
  return (
    <>
      <RfqHeader
        rfqId={comparison.rfqId}
        reference={comparison.reference}
        title={comparison.title}
        status={null}
        screenKey="pl.rfqs.comparison.title"
      >
        <Fact label={translate('pl.rfqs.detail.deadline')}>
          <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(comparison.deadline) })}</Mono>
        </Fact>
      </RfqHeader>
      <EmptyState
        titleKey="pl.rfqs.comparison.notYetClosed.title"
        descriptionKey="pl.rfqs.comparison.notYetClosed.description"
        action={
          <Link
            to="/rfqs/$rfqId"
            params={{ rfqId: comparison.rfqId }}
            search={{}}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {translate('pl.rfqs.comparison.notYetClosed.action')}
          </Link>
        }
      />
    </>
  );
}

function ComparisonView({ comparison }: { comparison: QuoteComparison }) {
  const translate = useTranslate();
  const queryClient = useQueryClient();
  useDocumentTitle('pl.rfqs.comparison.documentTitle', { reference: comparison.reference });
  const [target, setTarget] = useState<OutsideQuoteTarget | null>(null);
  const [recorded, setRecorded] = useState<{ supplier: string; line: number } | null>(null);
  const statusMessage = useRef<HTMLParagraphElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);
  const currencies: readonly [string, ...string[]] = [
    comparison.currency,
    ...comparison.exchangeRates.map((rate) => rate.currency),
  ];

  const openOutsideQuote = useCallback((next: OutsideQuoteTarget) => {
    returnFocusTo.current = null;
    setTarget(next);
  }, []);

  const recordOutsideQuote = (recordedTarget: OutsideQuoteTarget, quote: OutsideQuote) => {
    queryClient.setQueryData<ClientResult<ComparisonRead>>(
      queryKeyOf(quoteComparisonQuery, { rfqId: comparison.rfqId }),
      (current) => {
        if (current === undefined || !current.ok || current.value.availability !== 'available') {
          return current;
        }
        return {
          ok: true,
          value: withOutsideQuote(
            current.value,
            { lineId: recordedTarget.line.lineId, supplierId: recordedTarget.supplier.supplierId },
            quote,
            window.crypto.randomUUID(),
          ),
        };
      },
    );
    setRecorded({ supplier: recordedTarget.supplier.name, line: recordedTarget.line.lineNumber });
    returnFocusTo.current = statusMessage.current;
    setTarget(null);
  };

  return (
    <>
      <RfqHeader
        rfqId={comparison.rfqId}
        reference={comparison.reference}
        title={comparison.title}
        status={comparison.status}
        screenKey="pl.rfqs.comparison.title"
      >
        <Fact label={translate('pl.rfqs.comparison.closedAt')}>
          <Mono>{translate('pl.web.format.utc', { instant: formatInstantUtc(comparison.closedAt) })}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.detail.version')}>
          <Mono>{formatNumber(comparison.version)}</Mono>
        </Fact>
        <Fact label={translate('pl.rfqs.comparison.totalsIn')}>
          <Mono>{comparison.currency}</Mono>
        </Fact>
        {comparison.exchangeRates.map((rate) => (
          <Fact key={rate.currency} label={translate('pl.rfqs.comparison.rateLabel', { currency: rate.currency })}>
            <Mono>
              {translate(
                rate.source === 'manual' ? 'pl.rfqs.comparison.rateManual' : 'pl.rfqs.comparison.rateCentralBank',
                { rate: rate.rate, currency: comparison.currency, date: rate.capturedOn },
              )}
            </Mono>
          </Fact>
        ))}
      </RfqHeader>
      <section aria-labelledby="quotes-heading" className="flex flex-col gap-3">
        <h2 id="quotes-heading" className="text-lg font-semibold">
          {translate('pl.rfqs.comparison.quotes.title')}
        </h2>
        <div className="flex max-w-prose flex-col gap-1 text-sm">
          <p className="flex items-start gap-2">
            <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
            {translate('pl.rfqs.comparison.neverChosen')}
          </p>
          <p className="text-muted">
            {translate('pl.rfqs.comparison.normalisation', { currency: comparison.currency })}
          </p>
        </div>
        <GridLegend states={legendStates} />
        <p ref={statusMessage} role="status" tabIndex={-1} className="text-sm font-medium text-success outline-hidden">
          {recorded === null ? null : translate('pl.rfqs.outsideQuote.recorded', recorded)}
        </p>
        <ComparisonGrid
          label={translate('pl.rfqs.comparison.gridLabel', { reference: comparison.reference })}
          lines={comparison.lines}
          suppliers={comparison.suppliers}
          recordingAllowed={comparison.allowedTransitions.includes('recordOutsideQuote')}
          onRecordOutsideQuote={openOutsideQuote}
        />
      </section>
      <AwardDecisions comparison={comparison} />
      <OutsideQuoteDialog
        target={target}
        currencies={currencies}
        deadlineDate={comparison.closedAt.slice(0, 10)}
        returnFocusTo={returnFocusTo}
        onRecorded={recordOutsideQuote}
        onClose={() => {
          setTarget(null);
        }}
      />
    </>
  );
}
