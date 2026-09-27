import type { ComparisonCellState, ComparisonLine, Money, QuoteComparison } from '@partledger/contracts';
import { z } from 'zod';

import type { AdapterKind } from '../../api/api-client';

/**
 * After close a buyer can record a quote the supplier sent outside the portal before the
 * deadline (R42), for a line where the portal holds no current quote from that supplier.
 */
export function canRecordOutsideQuote(state: ComparisonCellState): boolean {
  return state === 'pending' || state === 'late' || state === 'stale';
}

export type OutsideQuoteAction =
  | { readonly kind: 'record' }
  | { readonly kind: 'unavailable'; readonly reasonKey: string }
  | { readonly kind: 'hidden' };

/**
 * Recording is a preview against the fixtures only. Against the API the action stays visible but
 * disabled with its reason until the command exists (U19), so no screen fakes a server write.
 */
export function outsideQuoteAction(
  adapterKind: AdapterKind,
  allowedTransitions: readonly string[],
): OutsideQuoteAction {
  if (!allowedTransitions.includes('recordOutsideQuote')) {
    return { kind: 'hidden' };
  }
  return adapterKind === 'fixture'
    ? { kind: 'record' }
    : { kind: 'unavailable', reasonKey: 'pl.rfqs.outsideQuote.notYetAvailable' };
}

/** Quotes count up to the deadline, not up to when the RFQ happened to close (R42). */
export function outsideQuoteDeadlineDate(comparison: Pick<QuoteComparison, 'deadline'>): string {
  return comparison.deadline.slice(0, 10);
}

/** The supplier documents the upload pipeline accepts (KTD22) and the largest it takes. */
export const outsideQuoteDocumentTypes = ['application/pdf', 'image/png', 'image/jpeg'] as const;

export const outsideQuoteDocumentMaxBytes = 20 * 1024 * 1024;

// Every problem is reported on the field itself, where the form shows one message for it.
const documentSchema = z
  .object({ name: z.string(), type: z.string(), size: z.number() })
  .nullable()
  .superRefine((document, context) => {
    const messageKey =
      document === null || document.name === ''
        ? 'pl.rfqs.outsideQuote.error.document'
        : !outsideQuoteDocumentTypes.some((allowed) => allowed === document.type)
          ? 'pl.rfqs.outsideQuote.error.documentType'
          : document.size <= 0
            ? 'pl.rfqs.outsideQuote.error.documentEmpty'
            : document.size > outsideQuoteDocumentMaxBytes
              ? 'pl.rfqs.outsideQuote.error.documentSize'
              : null;
    if (messageKey !== null) {
      context.addIssue({ code: 'custom', message: messageKey });
    }
  });

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
    document: documentSchema,
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
    document: null,
  };
}

/**
 * R21's total for the preview: the unit price times the quantity raised to the minimum order
 * quantity, plus one-off costs, converted at the rate the comparison captured. The API computes
 * the real total once the command exists.
 */
export function previewNormalisedTotal(
  comparison: Pick<QuoteComparison, 'currency' | 'exchangeRates'>,
  quantity: number,
  quote: Pick<OutsideQuote, 'unitPrice' | 'oneOffCosts' | 'currency' | 'minimumOrderQuantity'>,
): Money {
  const rate =
    quote.currency === comparison.currency
      ? 1
      : Number(comparison.exchangeRates.find((captured) => captured.currency === quote.currency)?.rate ?? Number.NaN);
  const total =
    (Number(quote.unitPrice) * Math.max(quantity, quote.minimumOrderQuantity) + Number(quote.oneOffCosts)) * rate;
  return { amount: total.toFixed(2), currency: comparison.currency };
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
                  normalisedTotal: previewNormalisedTotal(comparison, line.quantity, quote),
                  buyerRecorded: true,
                },
              }
            : cell,
        ),
      });
    }),
  };
}
