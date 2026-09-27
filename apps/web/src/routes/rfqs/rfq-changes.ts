import type { RfqDetail } from '@partledger/contracts';
import { z } from 'zod';

import { dateSchema } from '../../shell/date-field';
import { deadlineSchema, localDateTimeOf, quantitySchema, utcDateOf } from './rfq-form-fields';

/**
 * Extending the deadline applies to every supplier and records a reason (R16). The new deadline
 * is later than the current one and than now. Errors are message keys.
 */
export function extendFormSchema(detail: Pick<RfqDetail, 'deadline'>, now: string) {
  const after = Date.parse(detail.deadline) > Date.parse(now) ? detail.deadline : now;
  return z.object({
    deadline: deadlineSchema(after, {
      invalid: 'pl.rfqs.extend.error.deadline',
      tooEarly: 'pl.rfqs.extend.error.deadlineNotLater',
    }),
    reason: z.string().trim().min(1, 'pl.rfqs.extend.error.reason').max(1000, 'pl.rfqs.extend.error.reason'),
  });
}

export type ExtendFormInput = z.input<ReturnType<typeof extendFormSchema>>;

export type ExtendForm = z.output<ReturnType<typeof extendFormSchema>>;

export function emptyExtendForm(detail: Pick<RfqDetail, 'deadline'>): ExtendFormInput {
  return { deadline: localDateTimeOf(detail.deadline), reason: '' };
}

/** The preview's stand-in for extending (U16): a closed RFQ reopens for every supplier. */
export function withExtendedDeadline(detail: RfqDetail, form: ExtendForm): RfqDetail {
  return { ...detail, deadline: form.deadline, status: detail.status === 'closed' ? 'published' : detail.status };
}

/**
 * Amending changes one line's quantity or required date and creates the next version (R16).
 * The required date cannot fall before the deadline. Errors are message keys.
 */
export function amendFormSchema(detail: Pick<RfqDetail, 'deadline' | 'lines'>) {
  const deadlineDate = utcDateOf(detail.deadline);
  return z
    .object({
      lineId: z
        .string()
        .refine((lineId) => detail.lines.some((line) => line.lineId === lineId), 'pl.rfqs.amend.error.line'),
      quantity: quantitySchema('pl.rfqs.amend.error.quantity'),
      requiredBy: dateSchema('pl.rfqs.amend.error.requiredBy', [
        { test: (date) => date >= deadlineDate, message: 'pl.rfqs.amend.error.requiredBeforeDeadline' },
      ]),
    })
    .superRefine((form, context) => {
      const line = detail.lines.find((candidate) => candidate.lineId === form.lineId);
      if (line !== undefined && line.quantity === form.quantity && line.requiredBy === form.requiredBy) {
        context.addIssue({ code: 'custom', path: ['quantity'], message: 'pl.rfqs.amend.error.unchanged' });
      }
    });
}

export type AmendFormInput = z.input<ReturnType<typeof amendFormSchema>>;

export type AmendForm = z.output<ReturnType<typeof amendFormSchema>>;

export function amendFormFor(line: RfqDetail['lines'][number] | undefined): AmendFormInput {
  return {
    lineId: line?.lineId ?? '',
    quantity: line === undefined ? '' : String(line.quantity),
    requiredBy: line?.requiredBy ?? '',
  };
}

/**
 * The preview's stand-in for amending (U16): the next version with the line changed. Answers to
 * the changed line become stale on the server and invited suppliers are notified.
 */
export function withAmendment(detail: RfqDetail, form: AmendForm): RfqDetail {
  return {
    ...detail,
    version: detail.version + 1,
    lines: detail.lines.map((line) =>
      line.lineId === form.lineId ? { ...line, quantity: form.quantity, requiredBy: form.requiredBy } : line,
    ),
  };
}
