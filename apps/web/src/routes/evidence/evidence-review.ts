import type { EvidenceDeviation, EvidenceGap, ReviewQueue } from '@partledger/contracts';
import { z } from 'zod';

import { dateSchema } from '../../shell/date-field';

/** A rejection tells the supplier what to fix, so it needs a reason before the action enables. */
export function isRejectionReasonGiven(reason: string): boolean {
  return reason.trim() !== '';
}

export const reasonMaxLength = 1000;

/** Errors are message keys; each accepts the `asOf` and `max` params the form passes. */
export function deviationFormSchema(limits: Pick<ReviewQueue, 'asOf' | 'maxDeviationUntil'>) {
  return z.object({
    reason: z
      .string()
      .trim()
      .min(1, 'pl.evidence.deviation.error.reason')
      .max(reasonMaxLength, 'pl.evidence.deviation.error.reason'),
    expiresOn: dateSchema('pl.evidence.deviation.error.until', [
      { test: (date) => date > limits.asOf, message: 'pl.evidence.deviation.error.untilPast' },
      { test: (date) => date <= limits.maxDeviationUntil, message: 'pl.evidence.deviation.error.untilTooLate' },
    ]),
  });
}

export type DeviationFormInput = z.input<ReturnType<typeof deviationFormSchema>>;

export type DeviationForm = z.output<ReturnType<typeof deviationFormSchema>>;

export function gapKey(gap: Pick<EvidenceGap, 'supplier' | 'evidenceType'>): string {
  return `${gap.supplier.supplierId} ${gap.evidenceType.code}`;
}

/**
 * The preview's stand-in for confirming or rejecting (U15): the document leaves the queue.
 * Against the API the screen reads the queue again instead.
 */
export function withoutDocument(queue: ReviewQueue, documentId: string): ReviewQueue {
  return { ...queue, documents: queue.documents.filter((document) => document.documentId !== documentId) };
}

/**
 * The preview's stand-in for recording a deviation (U15): the gap shows it as covered, and a
 * second deviation is blocked with the reason the server would give.
 */
export function withDeviation(queue: ReviewQueue, key: string, deviation: EvidenceDeviation): ReviewQueue {
  return {
    ...queue,
    gaps: queue.gaps.map((gap) =>
      gapKey(gap) === key
        ? {
            ...gap,
            deviation,
            allowedTransitions: [],
            blockingReasons: [
              {
                transition: 'recordDeviation',
                message: 'pl.evidence.blocked.alreadyCovered',
                params: { until: deviation.expiresOn },
              },
            ],
          }
        : gap,
    ),
  };
}
