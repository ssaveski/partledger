import type { RfqAssignment, RfqDetail } from '@partledger/contracts';
import { z } from 'zod';

/** Which suppliers are invited to each line, in the assignment's line order. */
export interface AssignmentFormValues {
  lines: { lineId: string; supplierIds: string[] }[];
}

export function assignmentFormFrom(assignment: Pick<RfqAssignment, 'lines'>): AssignmentFormValues {
  return {
    lines: assignment.lines.map((line) => ({
      lineId: line.lineId,
      supplierIds: line.candidates.filter((candidate) => candidate.assigned).map((candidate) => candidate.supplierId),
    })),
  };
}

export type AssignmentIntent = 'save' | 'publish';

/**
 * Errors are message keys. Saving accepts lines without suppliers; publishing needs one on every
 * line (R15). Under the block policy a supplier outside a line's approved scope is refused.
 */
export function assignmentFormSchema(
  assignment: Pick<RfqAssignment, 'lines' | 'outOfScopePolicy'>,
  intent: AssignmentIntent,
) {
  return z
    .object({ lines: z.array(z.object({ lineId: z.string(), supplierIds: z.array(z.string()) })) })
    .superRefine((form, context) => {
      form.lines.forEach((values, index) => {
        const line = assignment.lines[index];
        if (line === undefined) {
          return;
        }
        if (intent === 'publish' && values.supplierIds.length === 0) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'supplierIds'],
            message: 'pl.rfqs.assignment.error.noSupplier',
          });
        }
        const outOfScope = line.candidates.filter(
          (candidate) => !candidate.inScope && values.supplierIds.includes(candidate.supplierId),
        );
        if (assignment.outOfScopePolicy === 'block' && outOfScope.length > 0) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'supplierIds'],
            message: 'pl.rfqs.assignment.error.outOfScopeBlocked',
          });
        }
      });
    });
}

/** Whether a candidate may be ticked: under the block policy only suppliers inside the line's scope can. */
export function canInvite(policy: RfqAssignment['outOfScopePolicy'], inScope: boolean): boolean {
  return policy === 'warn' || inScope;
}

/** The preview's stand-in for saving invitations (U16). */
export function withInvitations(assignment: RfqAssignment, values: AssignmentFormValues): RfqAssignment {
  return {
    ...assignment,
    lines: assignment.lines.map((line, index) => {
      const invited = values.lines[index]?.supplierIds ?? [];
      return {
        ...line,
        candidates: line.candidates.map((candidate) => ({
          ...candidate,
          assigned: invited.includes(candidate.supplierId),
        })),
      };
    }),
  };
}

/**
 * The preview's stand-in for publishing (U16): the RFQ opens, every invited supplier appears as
 * not yet responded, and the assignment can no longer change without an amendment.
 */
export function publishedPreview(
  assignment: RfqAssignment,
  detail: RfqDetail,
  values: AssignmentFormValues,
): { readonly assignment: RfqAssignment; readonly detail: RfqDetail } {
  const invited = withInvitations(assignment, values);
  const linesBySupplier = new Map<string, { name: string; lines: number }>();
  for (const line of invited.lines) {
    for (const candidate of line.candidates.filter((option) => option.assigned)) {
      const current = linesBySupplier.get(candidate.supplierId);
      linesBySupplier.set(candidate.supplierId, { name: candidate.name, lines: (current?.lines ?? 0) + 1 });
    }
  }
  const alreadyPublished = { message: 'pl.rfqs.blocked.alreadyPublished', params: {} };
  return {
    assignment: {
      ...invited,
      status: 'published',
      allowedTransitions: [],
      blockingReasons: [
        { transition: 'assign', ...alreadyPublished },
        { transition: 'publish', ...alreadyPublished },
      ],
    },
    detail: {
      ...detail,
      status: 'published',
      suppliers: [...linesBySupplier.entries()]
        .map(([supplierId, { name, lines }]) => ({
          supplierId,
          name,
          linesAssigned: lines,
          response: 'notYet' as const,
          respondedAt: null,
        }))
        .sort((first, second) => first.name.localeCompare(second.name)),
      allowedTransitions: ['amend', 'extendDeadline', 'close', 'cancel'],
      blockingReasons: [{ transition: 'publish', ...alreadyPublished }],
    },
  };
}
