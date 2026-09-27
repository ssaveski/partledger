import type { ResponseLine } from '@partledger/contracts/portal';
import { describe, expect, it } from 'vitest';

import { lineAnswer, responseFormSchema, responseFormValues, type LineFormValues } from './respond-form';

const baseLine: ResponseLine = {
  lineId: '00000000-0000-4000-8000-000000008104',
  lineNumber: 4,
  partNumber: 'PN-31005',
  revision: 'D',
  description: 'Fastener kit, 48 pieces',
  quantity: 2000,
  unit: 'each',
  requiredBy: '2026-11-20',
  quantityBreaks: [2000, 5000],
  changed: null,
  draft: null,
};

const quoted: LineFormValues = {
  lineId: baseLine.lineId,
  kind: 'quote',
  currency: 'CAD',
  unitPrices: ['1.85', '1.62'],
  leadTimeDays: '28',
  minimumOrderQuantity: '1000',
  oneOffCosts: '0',
  validUntil: '2026-12-31',
  noQuoteReason: '',
  noQuoteNote: '',
  specification: '',
};

function errorsOf(lines: LineFormValues[], declaredName = 'Morgan Ellery', attestation = true) {
  const result = responseFormSchema([baseLine]).safeParse({ lines, declaredName, attestation });
  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
}

describe('the response form', () => {
  it('starts from the saved draft, one unit price per quantity break the buyer asked for', () => {
    const values = responseFormValues(
      [
        {
          ...baseLine,
          draft: {
            kind: 'quote',
            currency: 'USD',
            priceBreaks: [{ quantity: 5000, unitPrice: '1.40' }],
            leadTimeDays: 30,
            minimumOrderQuantity: 500,
            oneOffCosts: '250.00',
            validUntil: '2027-01-31',
          },
        },
      ],
      'CAD',
    );
    expect(values.lines[0]).toMatchObject({ kind: 'quote', currency: 'USD', unitPrices: ['', '1.40'] });
    expect(values.declaredName).toBe('');
    expect(values.attestation).toBe(false);
  });

  it('starts an unanswered line in the buyer currency with nothing chosen', () => {
    expect(responseFormValues([baseLine], 'CAD').lines[0]).toMatchObject({ kind: '', currency: 'CAD' });
  });

  it('turns complete fields into the answer the API takes, and incomplete ones into no answer', () => {
    expect(lineAnswer(quoted, baseLine.quantityBreaks)).toEqual({
      kind: 'quote',
      currency: 'CAD',
      priceBreaks: [
        { quantity: 2000, unitPrice: '1.85' },
        { quantity: 5000, unitPrice: '1.62' },
      ],
      leadTimeDays: 28,
      minimumOrderQuantity: 1000,
      oneOffCosts: '0',
      validUntil: '2026-12-31',
    });
    expect(lineAnswer({ ...quoted, leadTimeDays: '4 weeks' }, baseLine.quantityBreaks)).toBeNull();
    expect(lineAnswer({ ...quoted, kind: '' }, baseLine.quantityBreaks)).toBeNull();
    expect(
      lineAnswer({ ...quoted, kind: 'noQuote', noQuoteReason: 'capacity', noQuoteNote: '  ' }, baseLine.quantityBreaks),
    ).toEqual({ kind: 'noQuote', reason: 'capacity', note: null });
  });

  it('accepts a complete answer with the declared name and attestation', () => {
    expect(errorsOf([quoted])).toEqual([]);
  });

  it('requires an answer on every line, and the declared name and authority attestation to submit', () => {
    expect(errorsOf([{ ...quoted, kind: '' }], '  ', false)).toEqual([
      ['lines.0.kind', 'pl.portal.respond.error.answerRequired'],
      ['declaredName', 'pl.portal.respond.error.declaredName'],
      ['attestation', 'pl.portal.respond.error.attestation'],
    ]);
  });

  it('names each price field that is missing or not a number', () => {
    expect(
      errorsOf([
        {
          ...quoted,
          unitPrices: ['1.85', '0'],
          leadTimeDays: '-1',
          minimumOrderQuantity: '0',
          oneOffCosts: '',
          validUntil: '',
        },
      ]),
    ).toEqual([
      ['lines.0.unitPrices.1', 'pl.portal.respond.error.unitPrice'],
      ['lines.0.leadTimeDays', 'pl.portal.respond.error.leadTimeDays'],
      ['lines.0.minimumOrderQuantity', 'pl.portal.respond.error.minimumOrderQuantity'],
      ['lines.0.oneOffCosts', 'pl.portal.respond.error.oneOffCosts'],
      ['lines.0.validUntil', 'pl.portal.respond.error.validUntil'],
    ]);
  });

  it('needs the specification of an alternate part and a note when no-quote gives another reason', () => {
    expect(errorsOf([{ ...quoted, kind: 'alternate' }])).toEqual([
      ['lines.0.specification', 'pl.portal.respond.error.specification'],
    ]);
    expect(errorsOf([{ ...quoted, kind: 'noQuote' }])).toEqual([
      ['lines.0.noQuoteReason', 'pl.portal.respond.error.noQuoteReason'],
    ]);
    expect(errorsOf([{ ...quoted, kind: 'noQuote', noQuoteReason: 'other' }])).toEqual([
      ['lines.0.noQuoteNote', 'pl.portal.respond.error.noQuoteNote'],
    ]);
  });
});
