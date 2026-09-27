import { reviewQueueSchema } from '@partledger/contracts';
import { evidenceFixtureOutputs, fixtureEvidenceDocumentIds } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import {
  deviationFormSchema,
  gapKey,
  isRejectionReasonGiven,
  withDeviation,
  withoutDocument,
  withRejection,
} from './evidence-review';

const queue = reviewQueueSchema.parse(evidenceFixtureOutputs.reviewQueue);

describe('rejecting evidence', () => {
  it('needs a reason with more than white space', () => {
    expect(isRejectionReasonGiven('')).toBe(false);
    expect(isRejectionReasonGiven('   \n')).toBe(false);
    expect(isRejectionReasonGiven('The certificate names another company.')).toBe(true);
  });

  it('takes the document out of the queue in the preview', () => {
    const next = withoutDocument(queue, fixtureEvidenceDocumentIds.renewedQualityCertificate);
    expect(next.documents).toHaveLength(queue.documents.length - 1);
    expect(
      next.documents.some((document) => document.documentId === fixtureEvidenceDocumentIds.renewedQualityCertificate),
    ).toBe(false);
  });
});

describe('the preview rejection', () => {
  const documentId = fixtureEvidenceDocumentIds.renewedQualityCertificate;

  it('takes the reason with the document, as the command will', () => {
    const next = withRejection(queue, { documentId, reason: 'The certificate names another company.' });
    expect(next.documents.some((document) => document.documentId === documentId)).toBe(false);
  });

  it('changes nothing without a reason', () => {
    expect(withRejection(queue, { documentId, reason: '  ' })).toEqual(queue);
  });
});

describe('recording a deviation', () => {
  const schema = deviationFormSchema(queue);

  it('refuses a reason longer than the field allows with its own message', () => {
    const result = schema.safeParse({ reason: 'x'.repeat(1001), expiresOn: '2026-12-31' });
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(['pl.evidence.deviation.error.reasonTooLong']);
  });

  it('needs a reason and an end date after today and no later than the limit', () => {
    const messages = (value: unknown) => schema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];
    expect(messages({ reason: ' ', expiresOn: '' })).toEqual([
      'pl.evidence.deviation.error.reason',
      'pl.evidence.deviation.error.until',
    ]);
    expect(messages({ reason: 'Renewal is booked.', expiresOn: queue.asOf })).toEqual([
      'pl.evidence.deviation.error.untilPast',
    ]);
    expect(messages({ reason: 'Renewal is booked.', expiresOn: '2027-03-27' })).toEqual([
      'pl.evidence.deviation.error.untilTooLate',
    ]);
    expect(schema.parse({ reason: ' Renewal is booked. ', expiresOn: queue.maxDeviationUntil })).toEqual({
      reason: 'Renewal is booked.',
      expiresOn: '2027-03-26',
    });
  });

  it('covers the gap and blocks a second deviation with the reason the server gives', () => {
    const gap = queue.gaps.find((candidate) => candidate.deviation === null);
    if (gap === undefined) {
      throw new Error('The queue has an uncovered gap');
    }
    const deviation = {
      deviationId: '00000000-0000-4000-8000-000000007777',
      reason: 'Renewal is booked.',
      recordedBy: 'A quality engineer',
      recordedAt: '2026-09-27T12:00:00Z',
      expiresOn: '2026-12-31',
    };
    const next = reviewQueueSchema.parse(withDeviation(queue, gapKey(gap), deviation));
    const covered = next.gaps.find((candidate) => gapKey(candidate) === gapKey(gap));
    expect(covered?.deviation).toEqual(deviation);
    expect(covered?.allowedTransitions).toEqual([]);
    expect(covered?.blockingReasons).toEqual([
      { transition: 'recordDeviation', message: 'pl.evidence.blocked.alreadyCovered', params: { until: '2026-12-31' } },
    ]);
    expect(next.gaps.filter((candidate) => gapKey(candidate) !== gapKey(gap))).toEqual(
      queue.gaps.filter((candidate) => gapKey(candidate) !== gapKey(gap)),
    );
  });
});
