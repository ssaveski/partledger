import { comparisonReadSchema, type QuoteComparison } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import {
  canRecordOutsideQuote,
  emptyOutsideQuote,
  outsideQuoteAction,
  outsideQuoteDeadlineDate,
  outsideQuoteDocumentMaxBytes,
  outsideQuoteFormSchema,
  previewNormalisedTotal,
  withOutsideQuote,
} from './outside-quote';

function closedComparison(): QuoteComparison {
  const parsed = comparisonReadSchema.parse(
    rfqFixtureOutputs.comparisons.find((candidate) => candidate.rfqId === fixtureRfqIds.closed),
  );
  if (parsed.availability !== 'available') {
    throw new Error('The closed RFQ has a comparison');
  }
  return parsed;
}

const schema = outsideQuoteFormSchema(['CAD', 'USD'], '2026-09-22');

const filled = {
  ...emptyOutsideQuote('CAD'),
  unitPrice: '3.30',
  leadTimeDays: '20',
  validUntil: '2026-12-31',
  receivedOn: '2026-09-21',
  document: { name: 'kestrel-quote.pdf', type: 'application/pdf', size: 20_480 },
};

describe('recording a quote received outside the portal', () => {
  it('is offered only where the portal holds no current quote from the supplier', () => {
    expect(canRecordOutsideQuote('pending')).toBe(true);
    expect(canRecordOutsideQuote('late')).toBe(true);
    expect(canRecordOutsideQuote('stale')).toBe(true);
    for (const state of ['bestPrice', 'submitted', 'alternate', 'noQuote'] as const) {
      expect(canRecordOutsideQuote(state)).toBe(false);
    }
  });

  it('accepts a complete quote and counts empty one-off costs as zero', () => {
    const result = schema.safeParse(filled);
    expect(result.success && result.data).toMatchObject({
      unitPrice: '3.30',
      oneOffCosts: '0',
      minimumOrderQuantity: 1,
      leadTimeDays: 20,
    });
  });

  it('refuses a quote that arrived after the deadline', () => {
    const result = schema.safeParse({ ...filled, receivedOn: '2026-09-23' });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      'pl.rfqs.outsideQuote.error.receivedAfterDeadline',
    ]);
  });

  it('refuses a missing document, a zero price and a currency without a captured rate', () => {
    const result = schema.safeParse({ ...filled, document: null, unitPrice: '0', currency: 'EUR' });
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'pl.rfqs.outsideQuote.error.currency',
      'pl.rfqs.outsideQuote.error.document',
      'pl.rfqs.outsideQuote.error.unitPrice',
    ]);
  });

  it('refuses a document outside the upload allowlist, an empty one and one over the size cap', () => {
    const messageFor = (document: { name: string; type: string; size: number }) =>
      schema.safeParse({ ...filled, document }).error?.issues.map((issue) => [issue.path, issue.message]);
    expect(messageFor({ name: 'quote.docx', type: 'application/msword', size: 100 })).toEqual([
      [['document'], 'pl.rfqs.outsideQuote.error.documentType'],
    ]);
    expect(messageFor({ name: 'quote.pdf', type: 'application/pdf', size: 0 })).toEqual([
      [['document'], 'pl.rfqs.outsideQuote.error.documentEmpty'],
    ]);
    expect(messageFor({ name: 'quote.pdf', type: 'application/pdf', size: outsideQuoteDocumentMaxBytes + 1 })).toEqual([
      [['document'], 'pl.rfqs.outsideQuote.error.documentSize'],
    ]);
    expect(schema.safeParse({ ...filled, document: { name: 'q.jpg', type: 'image/jpeg', size: 1 } }).success).toBe(
      true,
    );
  });

  it('counts quotes up to the deadline, not the close, whether the RFQ closed early or late', () => {
    const earlyClose = { deadline: '2026-09-24T16:00:00Z', closedAt: '2026-09-22T16:00:00Z' };
    const lateClose = { deadline: '2026-09-18T16:00:00Z', closedAt: '2026-09-19T00:15:00Z' };
    const early = outsideQuoteFormSchema(['CAD'], outsideQuoteDeadlineDate(earlyClose));
    expect(early.safeParse({ ...filled, receivedOn: '2026-09-23' }).success).toBe(true);
    expect(early.safeParse({ ...filled, receivedOn: '2026-09-25' }).success).toBe(false);
    const late = outsideQuoteFormSchema(['CAD'], outsideQuoteDeadlineDate(lateClose));
    expect(late.safeParse({ ...filled, receivedOn: '2026-09-18' }).success).toBe(true);
    expect(late.safeParse({ ...filled, receivedOn: '2026-09-19' }).success).toBe(false);
  });

  it('records locally only in the fixture preview; against the API the action is unavailable with its reason', () => {
    expect(outsideQuoteAction('fixture', ['recordOutsideQuote', 'submitAward'])).toEqual({ kind: 'record' });
    expect(outsideQuoteAction('http', ['recordOutsideQuote'])).toEqual({
      kind: 'unavailable',
      reasonKey: 'pl.rfqs.outsideQuote.notYetAvailable',
    });
    expect(outsideQuoteAction('fixture', ['submitAward'])).toEqual({ kind: 'hidden' });
    expect(outsideQuoteAction('http', [])).toEqual({ kind: 'hidden' });
  });

  it('converts a recorded quote at the rate the comparison captured', () => {
    const rates = {
      currency: 'CAD',
      exchangeRates: [{ currency: 'USD', rate: '2', capturedOn: '2026-09-22', source: 'manual' as const }],
    };
    const quote = { unitPrice: '3.00', oneOffCosts: '100', currency: 'USD', minimumOrderQuantity: 500 };
    expect(previewNormalisedTotal(rates, 200, quote)).toEqual({ amount: '3200.00', currency: 'CAD' });
    expect(previewNormalisedTotal(rates, 200, { ...quote, currency: 'CAD' })).toEqual({
      amount: '1600.00',
      currency: 'CAD',
    });
  });

  it('marks the recorded quote as buyer-recorded and highlights the new lowest total', () => {
    const comparison = closedComparison();
    const line4 = comparison.lines.find((line) => line.lineNumber === 4);
    const kestrel = comparison.suppliers.find((supplier) => supplier.name === 'Kestrel Machining');
    const birchfield = comparison.suppliers.find((supplier) => supplier.name === 'Birchfield Precision');
    if (line4 === undefined || kestrel === undefined || birchfield === undefined) {
      throw new Error('The closed RFQ has line 4 with Kestrel and Birchfield');
    }
    const quote = schema.parse(filled);
    const updated = withOutsideQuote(
      comparison,
      { lineId: line4.lineId, supplierId: kestrel.supplierId },
      quote,
      '00000000-0000-4000-8000-000000009999',
    );
    const updatedLine = updated.lines.find((line) => line.lineId === line4.lineId);
    const cellOf = (id: string) => updatedLine?.cells.find((cell) => cell.supplierId === id);
    expect(cellOf(kestrel.supplierId)).toMatchObject({
      state: 'bestPrice',
      quote: { buyerRecorded: true, normalisedTotal: { amount: '6600.00', currency: 'CAD' } },
    });
    expect(cellOf(birchfield.supplierId)?.state).toBe('submitted');
    expect(updatedLine?.lowestSupplierId).toBe(kestrel.supplierId);
    expect(updated.lines.filter((line) => line.lineId !== line4.lineId)).toEqual(
      comparison.lines.filter((line) => line.lineId !== line4.lineId),
    );
  });

  it('keeps the existing lowest total when the recorded quote is higher', () => {
    const comparison = closedComparison();
    const line4 = comparison.lines.find((line) => line.lineNumber === 4);
    const kestrel = comparison.suppliers.find((supplier) => supplier.name === 'Kestrel Machining');
    if (line4 === undefined || kestrel === undefined) {
      throw new Error('The closed RFQ has line 4 with Kestrel');
    }
    const updated = withOutsideQuote(
      comparison,
      { lineId: line4.lineId, supplierId: kestrel.supplierId },
      schema.parse({ ...filled, unitPrice: '9.00' }),
      '00000000-0000-4000-8000-000000009999',
    );
    const updatedLine = updated.lines.find((line) => line.lineId === line4.lineId);
    expect(updatedLine?.lowestSupplierId).toBe(line4.lowestSupplierId);
    expect(updatedLine?.cells.find((cell) => cell.supplierId === kestrel.supplierId)?.state).toBe('submitted');
  });
});
