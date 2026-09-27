import {
  partListSchema,
  rfqDetailSchema,
  rfqAssignmentSchema,
  rfqListSchema,
  supplierListSchema,
} from '@partledger/contracts';
import { partFixtureOutputs, rfqFixtureOutputs, supplierFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { builderFormSchema, nextReference, previewDraft, previewInScope, withListRow } from './rfq-builder';
import { quantityBreaksSchema, utcInstantOf } from './rfq-form-fields';

const parts = partListSchema.parse(partFixtureOutputs.list).parts;
const suppliers = supplierListSchema.parse(supplierFixtureOutputs.list).suppliers;
const list = rfqListSchema.parse(rfqFixtureOutputs.list);
const now = '2026-09-27T12:00:00Z';

function part(partNumber: string) {
  const found = parts.find((candidate) => candidate.partNumber === partNumber);
  if (found === undefined) {
    throw new Error(`No fixture part ${partNumber}`);
  }
  return found;
}

const validForm = {
  title: 'Housings for the winter build',
  deadline: '2026-10-30T16:00',
  lines: [
    { partId: part('PN-10432').partId, quantity: '200', quantityBreaks: '100, 500', requiredBy: '2026-12-04' },
    { partId: part('PN-31005').partId, quantity: '1000', quantityBreaks: '', requiredBy: '2026-11-20' },
  ],
};

/** The message keys a form value fails with, by path. */
function errorsOf(value: unknown): Record<string, string> {
  const result = builderFormSchema(now).safeParse(value);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
}

describe('the RFQ builder form', () => {
  it('turns a complete form into a draft with a UTC deadline and numeric quantities', () => {
    const parsed = builderFormSchema(now).parse(validForm);
    expect(parsed.deadline).toBe('2026-10-30T16:00:00Z');
    expect(parsed.lines[0]).toEqual(expect.objectContaining({ quantity: 200, quantityBreaks: [100, 500] }));
    expect(parsed.lines[1]?.quantityBreaks).toEqual([]);
  });

  it('needs at least one part', () => {
    expect(errorsOf({ ...validForm, lines: [] })).toEqual({ lines: 'pl.rfqs.builder.error.noLines' });
  });

  it('refuses a deadline in the past and a required date before the deadline', () => {
    expect(errorsOf({ ...validForm, deadline: '2026-09-01T16:00' })).toEqual({
      deadline: 'pl.rfqs.builder.error.deadlinePast',
    });
    const early = { ...validForm, lines: [{ ...validForm.lines[1], requiredBy: '2026-10-29' }] };
    expect(errorsOf(early)).toEqual({ 'lines.0.requiredBy': 'pl.rfqs.builder.error.requiredBeforeDeadline' });
  });

  it('names each field that is missing', () => {
    const blank = { title: ' ', deadline: '', lines: [{ ...validForm.lines[0], quantity: '0', requiredBy: '' }] };
    expect(errorsOf(blank)).toEqual({
      title: 'pl.rfqs.builder.error.title',
      deadline: 'pl.rfqs.builder.error.deadline',
      'lines.0.quantity': 'pl.rfqs.builder.error.quantity',
      'lines.0.requiredBy': 'pl.rfqs.builder.error.requiredBy',
    });
  });
});

describe('quantity breaks', () => {
  const breaks = quantityBreaksSchema('invalid');

  it('accept up to six ascending whole quantities, separated by commas or spaces', () => {
    expect(breaks.parse('100, 250 500')).toEqual([100, 250, 500]);
    expect(breaks.parse('')).toEqual([]);
  });

  it('refuse zero, fractions, descending or repeated quantities, and more than six', () => {
    for (const value of ['0', '1.5', '500, 100', '100, 100', '1,2,3,4,5,6,7', 'ten']) {
      expect(breaks.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('a UTC deadline field', () => {
  it('reads a date and time as UTC and refuses dates that do not exist', () => {
    expect(utcInstantOf('2026-10-30T16:00')).toBe('2026-10-30T16:00:00Z');
    expect(utcInstantOf('2026-02-30T16:00')).toBeNull();
    expect(utcInstantOf('2026-10-30')).toBeNull();
  });
});

describe('the preview draft', () => {
  const form = builderFormSchema(now).parse(validForm);
  const draft = previewDraft(form, {
    rfqId: '00000000-0000-4000-8000-000000009999',
    reference: nextReference(list),
    currency: 'CAD',
    lineIds: ['00000000-0000-4000-8000-000000009001', '00000000-0000-4000-8000-000000009002'],
    parts,
    suppliers,
  });

  it('takes the next free reference', () => {
    expect(draft.detail.reference).toBe('RFQ-1051');
  });

  it('is a draft in the declared detail and assignment shapes, snapshotting each part', () => {
    const detail = rfqDetailSchema.parse(draft.detail);
    expect(detail.status).toBe('draft');
    expect(detail.lines.map((line) => [line.lineNumber, line.partNumber, line.revision])).toEqual([
      [1, 'PN-10432', 'C'],
      [2, 'PN-31005', 'D'],
    ]);
    expect(rfqAssignmentSchema.parse(draft.assignment).allowedTransitions).toEqual(['assign', 'publish']);
  });

  it('offers every supplier on every line, marking who is outside the line approved scope', () => {
    const castings = draft.assignment.lines[0];
    expect(castings?.candidates).toHaveLength(suppliers.length);
    expect(castings?.candidates.filter((candidate) => candidate.inScope).map((candidate) => candidate.name)).toEqual([
      'Northwind Castings',
    ]);
  });

  it('adds its row to the list, newest reference first', () => {
    expect(withListRow(list, draft.listRow).rfqs[0]?.reference).toBe('RFQ-1051');
  });
});

describe('the preview scope check', () => {
  it('counts only an active approval that covers the category', () => {
    const halden = suppliers.find((supplier) => supplier.name === 'Halden Electronics');
    const kestrel = suppliers.find((supplier) => supplier.name === 'Kestrel Machining');
    if (halden === undefined || kestrel === undefined) {
      throw new Error('Fixture suppliers are missing');
    }
    expect(previewInScope(halden, 'electronics')).toBe(false);
    expect(previewInScope(kestrel, 'machinedParts')).toBe(true);
    expect(previewInScope(kestrel, 'castings')).toBe(false);
  });
});
