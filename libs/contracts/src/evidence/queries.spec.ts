import { describe, expect, it } from 'vitest';

import { evidenceFixtureOutputs } from '../fixtures';
import { englishCatalogue } from '../i18n/catalogue';
import { expiryStatuses } from '../reads';
import { evidenceDownloadPath, evidenceProblems, reviewQueueQuery, reviewQueueSchema } from './queries';

const queue = reviewQueueSchema.parse(evidenceFixtureOutputs.reviewQueue);

/** Every message key a value carries, wherever it sits in the tree. */
function messageKeysIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return /^pl\.[a-z]+\./.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(messageKeysIn);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(messageKeysIn);
  }
  return [];
}

describe('the evidence review queue contract', () => {
  it('parses the synthetic review queue', () => {
    expect(reviewQueueSchema.safeParse(evidenceFixtureOutputs.reviewQueue).success).toBe(true);
  });

  it('never lets a document the scan has not cleared be confirmed or rejected', () => {
    const pending = queue.documents.filter((document) => document.scan === 'pending');
    expect(pending.length).toBeGreaterThan(0);
    for (const document of pending) {
      expect(document.allowedTransitions).toEqual([]);
      expect(document.blockingReasons.map((reason) => reason.transition).sort()).toEqual(['confirm', 'reject']);
    }
  });

  it('records whether a person or a supplier link uploaded each document', () => {
    const actors = new Set(queue.documents.map((document) => document.uploadedBy.actorType));
    expect(actors).toEqual(new Set(['person', 'supplier_token']));
    const [first] = evidenceFixtureOutputs.reviewQueue.documents;
    const byAgent = { ...first, uploadedBy: { name: 'Agent', actorType: 'ai_agent' } };
    expect(reviewQueueSchema.safeParse({ ...queue, documents: [byAgent] }).success).toBe(false);
  });

  it('gives an undated attestation a validity twelve months from its issue', () => {
    const undated = queue.documents.find((document) => document.expiresOn === null);
    expect(undated?.issuedOn).toBe('2026-09-15');
    expect(undated?.validUntil).toBe('2027-09-15');
  });

  it('dates a gap exactly when its evidence expired or was rejected, never when it is missing', () => {
    const [missing] = evidenceFixtureOutputs.reviewQueue.gaps.filter((gap) => gap.problem === 'missing');
    const [expired] = evidenceFixtureOutputs.reviewQueue.gaps.filter((gap) => gap.problem === 'expired');
    const withGap = (gap: unknown) =>
      reviewQueueSchema.safeParse({ ...evidenceFixtureOutputs.reviewQueue, gaps: [gap] });
    expect(withGap(missing).success).toBe(true);
    expect(withGap({ ...missing, since: '2026-09-01' }).success).toBe(false);
    expect(withGap(expired).success).toBe(true);
    expect(withGap({ ...expired, since: null }).success).toBe(false);
  });

  it('lets a deviation recorded today end after today', () => {
    const queue = evidenceFixtureOutputs.reviewQueue;
    expect(reviewQueueSchema.safeParse({ ...queue, maxDeviationUntil: queue.asOf }).success).toBe(false);
    expect(reviewQueueSchema.safeParse({ ...queue, maxDeviationUntil: '2026-09-28' }).success).toBe(true);
  });

  it('blocks a second deviation on a gap an active deviation covers', () => {
    for (const gap of queue.gaps) {
      expect(gap.allowedTransitions.includes('recordDeviation')).toBe(gap.deviation === null);
    }
  });

  it('declares a download under the API that names only the document', () => {
    expect(evidenceDownloadPath('00000000-0000-4000-8000-000000008001')).toBe(
      '/api/v1/evidence/documents/00000000-0000-4000-8000-000000008001/download',
    );
  });

  it('is a described evidence query without input', () => {
    expect(reviewQueueQuery.name).toBe('evidence.reviewQueue');
    expect(reviewQueueQuery.input.safeParse({}).success).toBe(true);
    expect(reviewQueueQuery.access.person).toContain('quality_engineer');
  });

  it('has an English message for every key the queue carries and every state the screen names', () => {
    const keys = [
      ...messageKeysIn(evidenceFixtureOutputs.reviewQueue),
      ...expiryStatuses.map((status) => `pl.evidence.expiry.${status}`),
      ...evidenceProblems.map((problem) => `pl.evidence.problem.${problem}`),
      'pl.evidence.scan.clean',
      'pl.evidence.scan.pending',
    ];
    expect(keys.filter((key) => !Object.hasOwn(englishCatalogue, key))).toEqual([]);
  });
});
