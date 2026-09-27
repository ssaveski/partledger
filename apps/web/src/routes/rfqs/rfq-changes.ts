import { partUnits, type RfqDetail } from '@partledger/contracts';
import { z } from 'zod';

import { dateSchema } from '../../shell/date-field';
import { deadlineSchema, localDateTimeOf, quantitySchema, utcDateOf } from './rfq-form-fields';

export const extendReasonMaxLength = 1000;

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
    reason: z
      .string()
      .trim()
      .min(1, 'pl.rfqs.extend.error.reason')
      .max(extendReasonMaxLength, 'pl.rfqs.extend.error.reasonTooLong'),
  });
}

export type ExtendFormInput = z.input<ReturnType<typeof extendFormSchema>>;

export type ExtendForm = z.output<ReturnType<typeof extendFormSchema>>;

export function emptyExtendForm(detail: Pick<RfqDetail, 'deadline'>): ExtendFormInput {
  return { deadline: localDateTimeOf(detail.deadline), reason: '' };
}

/**
 * The preview's stand-in for extending (U16): a closed RFQ reopens for every supplier, with the
 * transitions an open RFQ has. The reason travels with the form, as the command will take it.
 */
export function withExtendedDeadline(detail: RfqDetail, form: ExtendForm): RfqDetail {
  if (detail.status !== 'closed') {
    return { ...detail, deadline: form.deadline };
  }
  return {
    ...detail,
    deadline: form.deadline,
    status: 'published',
    allowedTransitions: ['amend', 'extendDeadline', 'close', 'cancel'],
    blockingReasons: [{ transition: 'publish', message: 'pl.rfqs.blocked.alreadyPublished', params: {} }],
  };
}

/**
 * Amending changes one line's quantity or required date, or re-issues a drifted line at the part's
 * current snapshot (R8), and creates the next version (R16). The required date cannot fall before
 * the deadline. Errors are message keys.
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
      reissueAtCurrentPart: z.boolean(),
    })
    .superRefine((form, context) => {
      const line = detail.lines.find((candidate) => candidate.lineId === form.lineId);
      if (line === undefined) {
        return;
      }
      const reissues = form.reissueAtCurrentPart && line.drift !== null;
      if (!reissues && line.quantity === form.quantity && line.requiredBy === form.requiredBy) {
        context.addIssue({ code: 'custom', path: ['quantity'], message: 'pl.rfqs.amend.error.unchanged' });
      }
    });
}

export type AmendFormInput = z.input<ReturnType<typeof amendFormSchema>>;

export type AmendForm = z.output<ReturnType<typeof amendFormSchema>>;

type DetailLine = RfqDetail['lines'][number];

/** The line an amendment starts on: the first whose part drifted, since that is what needs one. */
export function amendTarget(detail: Pick<RfqDetail, 'lines'>): DetailLine | undefined {
  return detail.lines.find((line) => line.drift !== null) ?? detail.lines[0];
}

/** A drifted line starts re-issued at the part's current snapshot; the buyer can keep the old one. */
export function amendFormFor(line: DetailLine | undefined): AmendFormInput {
  return {
    lineId: line?.lineId ?? '',
    quantity: line === undefined ? '' : String(line.quantity),
    requiredBy: line?.requiredBy ?? '',
    reissueAtCurrentPart: line !== undefined && line.drift !== null,
  };
}

const unitSchema = z.enum(partUnits);

/** The line with the part's current revision, description and unit, and no drift left. */
function reissued(line: DetailLine): DetailLine {
  let next: DetailLine = { ...line, drift: null };
  for (const change of line.drift?.changes ?? []) {
    if (change.field === 'revision') {
      next = { ...next, revision: change.current };
    } else if (change.field === 'description') {
      next = { ...next, description: change.current };
    } else {
      const unit = unitSchema.safeParse(change.current);
      next = unit.success ? { ...next, unit: unit.data } : next;
    }
  }
  return next;
}

/**
 * The preview's stand-in for amending (U16): the next version with the line changed. Answers to
 * the changed line become stale on the server and invited suppliers are notified.
 */
export function withAmendment(detail: RfqDetail, form: AmendForm): RfqDetail {
  return {
    ...detail,
    version: detail.version + 1,
    lines: detail.lines.map((line) => {
      if (line.lineId !== form.lineId) {
        return line;
      }
      const base = form.reissueAtCurrentPart ? reissued(line) : line;
      return { ...base, quantity: form.quantity, requiredBy: form.requiredBy };
    }),
  };
}
