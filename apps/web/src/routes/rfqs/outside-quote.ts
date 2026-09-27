import type { ComparisonCellState, ComparisonLine, QuoteComparison } from '@partledger/contracts';
import { fixtureNormalisedTotal } from '@partledger/contracts/fixtures';
import { z } from 'zod';

/**
 * After close a buyer can record a quote the supplier sent outside the portal before the
 * deadline (R42), for a line where the portal holds no current quote from that supplier.
 */
export function canRecordOutsideQuote(state: ComparisonCellState): boolean {
  return state === 'pending' || state === 'late' || state === 'stale';
}

const decimalPattern = /^\d{1,12}(\.\d{1,6})?$/;

function wholeNumber(minimum: number, messageKey: string) {
  return z
    .string()
    .regex(/^\d{1,9}$/, messageKey)
    .transform(Number)
    .refine((value) => value >= minimum, messageKey);
}

/** Errors are message keys. `deadlineDate` is the UTC date of the RFQ deadline. */
export function outsideQuoteFormSchema(currencies: readonly [string, ...string[]], deadlineDate: string) {
  return z.object({
    unitPrice: z
      .string()
      .regex(decimalPattern, 'pl.rfqs.outsideQuote.error.unitPrice')
      .refine((value) => Number(value) > 0, 'pl.rfqs.outsideQuote.error.unitPrice'),
    currency: z.enum(currencies, 'pl.rfqs.outsideQuote.error.currency'),
    minimumOrderQuantity: wholeNumber(1, 'pl.rfqs.outsideQuote.error.minimumOrderQuantity'),
    oneOffCosts: z
      .string()
      .regex(/^(\d{1,12}(\.\d{1,6})?)?$/, 'pl.rfqs.outsideQuote.error.oneOffCosts')
      .transform((value) => (value === '' ? '0' : value)),
    leadTimeDays: wholeNumber(0, 'pl.rfqs.outsideQuote.error.leadTimeDays'),
    receivedOn: z.iso
      .date('pl.rfqs.outsideQuote.error.receivedOn')
      .refine((value) => value <= deadlineDate, 'pl.rfqs.outsideQuote.error.receivedAfterDeadline'),
    validUntil: z.iso.date('pl.rfqs.outsideQuote.error.validUntil'),
    documentName: z.string().min(1, 'pl.rfqs.outsideQuote.error.document'),
  });
}

export type OutsideQuoteInput = z.input<ReturnType<typeof outsideQuoteFormSchema>>;

export type OutsideQuote = z.output<ReturnType<typeof outsideQuoteFormSchema>>;

export function emptyOutsideQuote(currency: string): OutsideQuoteInput {
  return {
    unitPrice: '',
    currency,
    minimumOrderQuantity: '1',
    oneOffCosts: '',
    leadTimeDays: '',
    receivedOn: '',
    validUntil: '',
    documentName: '',
  };
}

function withLowestHighlighted(line: ComparisonLine): ComparisonLine {
  const competing = line.cells.filter(
    (cell) => cell.quote !== null && (cell.state === 'bestPrice' || cell.state === 'submitted'),
  );
  const lowest = competing.reduce<(typeof competing)[number] | undefined>(
    (best, cell) =>
      best?.quote == null ||
      (cell.quote !== null && Number(cell.quote.normalisedTotal.amount) < Number(best.quote.normalisedTotal.amount))
        ? cell
        : best,
    undefined,
  );
  return {
    ...line,
    lowestSupplierId: lowest?.supplierId ?? null,
    cells: line.cells.map((cell) => {
      if (cell === lowest) {
        return { ...cell, state: 'bestPrice' };
      }
      return cell.state === 'bestPrice' ? { ...cell, state: 'submitted' } : cell;
    }),
  };
}

/**
 * The preview's stand-in for the command Phase D adds (U19): the cell takes the recorded quote,
 * marked buyer-recorded, and the line's lowest total is highlighted again. Against the API the
 * screen reads the comparison again instead.
 */
export function withOutsideQuote(
  comparison: QuoteComparison,
  target: { readonly lineId: string; readonly supplierId: string },
  quote: OutsideQuote,
  quoteId: string,
): QuoteComparison {
  return {
    ...comparison,
    lines: comparison.lines.map((line) => {
      if (line.lineId !== target.lineId) {
        return line;
      }
      return withLowestHighlighted({
        ...line,
        cells: line.cells.map((cell) =>
          cell.supplierId === target.supplierId
            ? {
                supplierId: cell.supplierId,
                state: 'submitted',
                alternate: null,
                noQuoteReason: null,
                quote: {
                  quoteId,
                  unitPrice: { amount: quote.unitPrice, currency: quote.currency },
                  oneOffCosts: { amount: quote.oneOffCosts, currency: quote.currency },
                  minimumOrderQuantity: quote.minimumOrderQuantity,
                  leadTimeDays: quote.leadTimeDays,
                  validUntil: quote.validUntil,
                  normalisedTotal: fixtureNormalisedTotal({
                    unitPrice: Number(quote.unitPrice),
                    oneOffCosts: Number(quote.oneOffCosts),
                    currency: quote.currency,
                    quantity: line.quantity,
                    minimumOrderQuantity: quote.minimumOrderQuantity,
                  }),
                  buyerRecorded: true,
                },
              }
            : cell,
        ),
      });
    }),
  };
}
