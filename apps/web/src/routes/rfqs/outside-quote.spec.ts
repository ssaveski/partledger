import { comparisonReadSchema, type QuoteComparison } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { canRecordOutsideQuote, emptyOutsideQuote, outsideQuoteFormSchema, withOutsideQuote } from './outside-quote';

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
  documentName: 'kestrel-quote.pdf',
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
    const result = schema.safeParse({ ...filled, documentName: '', unitPrice: '0', currency: 'EUR' });
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'pl.rfqs.outsideQuote.error.currency',
      'pl.rfqs.outsideQuote.error.document',
      'pl.rfqs.outsideQuote.error.unitPrice',
    ]);
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
