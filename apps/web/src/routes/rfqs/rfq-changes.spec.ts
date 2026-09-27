import { rfqDetailSchema } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import {
  amendFormFor,
  amendFormSchema,
  emptyExtendForm,
  extendFormSchema,
  withAmendment,
  withExtendedDeadline,
} from './rfq-changes';

function detailOf(rfqId: string) {
  return rfqDetailSchema.parse(rfqFixtureOutputs.details.find((output) => output.rfqId === rfqId));
}

const open = detailOf(fixtureRfqIds.open);
const now = '2026-09-27T12:00:00Z';

describe('extending the deadline', () => {
  it('needs a later deadline and a reason', () => {
    const schema = extendFormSchema(open, now);
    const unchanged = schema.safeParse(emptyExtendForm(open));
    expect(unchanged.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'pl.rfqs.extend.error.deadlineNotLater',
      'pl.rfqs.extend.error.reason',
    ]);
    expect(schema.parse({ deadline: '2026-10-16T16:00', reason: 'Two suppliers asked for a week more.' })).toEqual({
      deadline: '2026-10-16T16:00:00Z',
      reason: 'Two suppliers asked for a week more.',
    });
  });

  it('must end after now, even when the current deadline has passed', () => {
    const closed = detailOf(fixtureRfqIds.closed);
    const result = extendFormSchema(closed, now).safeParse({ deadline: '2026-09-25T16:00', reason: 'Late drawing.' });
    expect(result.error?.issues[0]?.message).toBe('pl.rfqs.extend.error.deadlineNotLater');
  });

  it('reopens a closed RFQ for every supplier in the preview', () => {
    const closed = detailOf(fixtureRfqIds.closed);
    const extended = withExtendedDeadline(closed, { deadline: '2026-10-16T16:00:00Z', reason: 'More time.' });
    expect(extended.status).toBe('published');
    expect(extended.deadline).toBe('2026-10-16T16:00:00Z');
  });
});

describe('amending a line', () => {
  const [first] = open.lines;

  it('starts from the line as published and refuses leaving it unchanged', () => {
    const values = amendFormFor(first);
    expect(values).toEqual({ lineId: first?.lineId, quantity: '200', requiredBy: '2026-12-04' });
    expect(amendFormSchema(open).safeParse(values).error?.issues[0]?.message).toBe('pl.rfqs.amend.error.unchanged');
  });

  it('refuses a required date before the deadline', () => {
    const result = amendFormSchema(open).safeParse({ ...amendFormFor(first), requiredBy: '2026-10-01' });
    expect(result.error?.issues[0]?.message).toBe('pl.rfqs.amend.error.requiredBeforeDeadline');
  });

  it('creates the next version with only that line changed', () => {
    const form = amendFormSchema(open).parse({ ...amendFormFor(first), quantity: '250' });
    const amended = withAmendment(open, form);
    expect(amended.version).toBe(open.version + 1);
    expect(amended.lines[0]?.quantity).toBe(250);
    expect(amended.lines.slice(1)).toEqual(open.lines.slice(1));
  });
});
