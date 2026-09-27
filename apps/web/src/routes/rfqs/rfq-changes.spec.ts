import { rfqDetailSchema } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import {
  amendFormFor,
  amendFormSchema,
  amendTarget,
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

  it('gives a reopened RFQ the transitions of an open one, so it can be extended again', () => {
    const closed = detailOf(fixtureRfqIds.closed);
    const extended = withExtendedDeadline(closed, { deadline: '2026-10-16T16:00:00Z', reason: 'More time.' });
    expect(extended.allowedTransitions).toEqual(['amend', 'extendDeadline', 'close', 'cancel']);
    expect(extended.blockingReasons.map((reason) => reason.transition)).toEqual(['publish']);
  });

  it('refuses a reason longer than the field allows with its own message', () => {
    const result = extendFormSchema(open, now).safeParse({ deadline: '2026-10-16T16:00', reason: 'x'.repeat(1001) });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['pl.rfqs.extend.error.reasonTooLong']);
  });
});

describe('amending a line', () => {
  const [first] = open.lines;

  it('starts from the line as published and refuses leaving it unchanged', () => {
    const values = amendFormFor(first);
    expect(values).toEqual({
      lineId: first?.lineId,
      quantity: '200',
      requiredBy: '2026-12-04',
      reissueAtCurrentPart: false,
    });
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

  it('starts on the first line whose part drifted, re-issuing it at the current part', () => {
    const target = amendTarget(open);
    expect(target?.partNumber).toBe('PN-20877');
    expect(amendFormFor(target).reissueAtCurrentPart).toBe(true);
  });

  it('re-issues a drifted line at the part current snapshot without other changes, clearing the drift', () => {
    const form = amendFormSchema(open).parse(amendFormFor(amendTarget(open)));
    const amended = withAmendment(open, form);
    const line = amended.lines.find((candidate) => candidate.partNumber === 'PN-20877');
    expect(line?.revision).toBe('C');
    expect(line?.drift).toBeNull();
    expect(amended.version).toBe(open.version + 1);
  });

  it('keeps the published snapshot when the buyer does not re-issue', () => {
    const values = { ...amendFormFor(amendTarget(open)), reissueAtCurrentPart: false, quantity: '150' };
    const line = withAmendment(open, amendFormSchema(open).parse(values)).lines.find(
      (candidate) => candidate.partNumber === 'PN-20877',
    );
    expect(line?.revision).toBe('B');
    expect(line?.drift).not.toBeNull();
    expect(line?.quantity).toBe(150);
  });
});
