import type {
  PartSummary,
  RfqAssignment,
  RfqDetail,
  RfqList,
  RfqListRow,
  SupplierSummary,
} from '@partledger/contracts';
import { z } from 'zod';

import { deadlineSchema, quantityBreaksSchema, quantitySchema, utcDateOf } from './rfq-form-fields';

/** The RFQ builder (R15): a title, a UTC deadline, and a line per part chosen from the parts list. */
export interface BuilderLineValues {
  partId: string;
  quantity: string;
  quantityBreaks: string;
  requiredBy: string;
}

export interface BuilderFormValues {
  title: string;
  deadline: string;
  lines: BuilderLineValues[];
}

/** The tenant currency until the tenant settings read exists (U8); only the preview uses it. */
export const previewTenantCurrency = 'CAD';

export function emptyBuilderForm(): BuilderFormValues {
  return { title: '', deadline: '', lines: [] };
}

export function builderLineFor(part: Pick<PartSummary, 'partId'>): BuilderLineValues {
  return { partId: part.partId, quantity: '', quantityBreaks: '', requiredBy: '' };
}

/** Errors are message keys. `now` is an ISO instant; the server decides again when it publishes. */
export function builderFormSchema(now: string) {
  return z
    .object({
      title: z.string().trim().min(1, 'pl.rfqs.builder.error.title').max(200, 'pl.rfqs.builder.error.title'),
      deadline: deadlineSchema(now, {
        invalid: 'pl.rfqs.builder.error.deadline',
        tooEarly: 'pl.rfqs.builder.error.deadlinePast',
      }),
      lines: z
        .array(
          z.object({
            partId: z.uuid(),
            quantity: quantitySchema('pl.rfqs.builder.error.quantity'),
            quantityBreaks: quantityBreaksSchema('pl.rfqs.builder.error.quantityBreaks'),
            requiredBy: z.iso.date('pl.rfqs.builder.error.requiredBy'),
          }),
        )
        .min(1, 'pl.rfqs.builder.error.noLines'),
    })
    .superRefine((form, context) => {
      const deadlineDate = utcDateOf(form.deadline);
      form.lines.forEach((line, index) => {
        if (line.requiredBy < deadlineDate) {
          context.addIssue({
            code: 'custom',
            path: ['lines', index, 'requiredBy'],
            message: 'pl.rfqs.builder.error.requiredBeforeDeadline',
          });
        }
      });
    });
}

export type BuilderForm = z.output<ReturnType<typeof builderFormSchema>>;

/** The next free reference after every RFQ the reader can see. */
export function nextReference(list: Pick<RfqList, 'rfqs'>): string {
  const highest = list.rfqs.reduce((current, rfq) => {
    const number = Number(/^RFQ-(\d+)/.exec(rfq.reference)?.[1] ?? 0);
    return Math.max(current, number);
  }, 1000);
  return `RFQ-${highest + 1}`;
}

/** Whether an active approval covers the category; the server decides this for real (U16). */
export function previewInScope(
  supplier: Pick<SupplierSummary, 'approval'>,
  category: PartSummary['category'],
): boolean {
  const { status, expiry, scope } = supplier.approval;
  return (status === 'approved' || status === 'conditional') && expiry !== 'expired' && scope.includes(category);
}

export interface PreviewDraft {
  readonly detail: RfqDetail;
  readonly assignment: RfqAssignment;
  readonly listRow: RfqListRow;
}

/**
 * The preview's stand-in for saving a draft (U16): the detail, the assignment and the list row the
 * API would return for it. `lineIds` gives each line its id, one per line in order.
 */
export function previewDraft(
  form: BuilderForm,
  context: {
    readonly rfqId: string;
    readonly reference: string;
    readonly currency: string;
    readonly lineIds: readonly string[];
    readonly parts: readonly PartSummary[];
    readonly suppliers: readonly SupplierSummary[];
  },
): PreviewDraft {
  const lines = form.lines.map((line, index) => {
    const part = context.parts.find((candidate) => candidate.partId === line.partId);
    const lineId = context.lineIds[index];
    if (part === undefined || lineId === undefined) {
      throw new Error('Every builder line names a listed part and has an id');
    }
    return {
      lineId,
      lineNumber: index + 1,
      partNumber: part.partNumber,
      revision: part.revision,
      description: part.description,
      quantity: line.quantity,
      unit: part.unit,
      quantityBreaks: line.quantityBreaks,
      requiredBy: line.requiredBy,
    };
  });
  const categoryOf = (index: number) => {
    const partId = form.lines[index]?.partId;
    const part = context.parts.find((candidate) => candidate.partId === partId);
    if (part === undefined) {
      throw new Error('Every builder line names a listed part');
    }
    return part.category;
  };
  const detail: RfqDetail = {
    rfqId: context.rfqId,
    reference: context.reference,
    title: form.title,
    status: 'draft',
    version: 1,
    deadline: form.deadline,
    currency: context.currency,
    round: 1,
    lines: lines.map((line) => ({ ...line, drift: null })),
    suppliers: [],
    allowedTransitions: ['cancel'],
    blockingReasons: [{ transition: 'publish', message: 'pl.rfqs.blocked.noSuppliers', params: {} }],
  };
  const assignment: RfqAssignment = {
    rfqId: context.rfqId,
    reference: context.reference,
    title: form.title,
    status: 'draft',
    version: 1,
    deadline: form.deadline,
    outOfScopePolicy: 'warn',
    lines: lines.map((line, index) => ({
      ...line,
      category: categoryOf(index),
      candidates: context.suppliers.map((supplier) => ({
        supplierId: supplier.supplierId,
        name: supplier.name,
        assigned: false,
        inScope: previewInScope(supplier, categoryOf(index)),
        approval: supplier.approval,
        evidence: supplier.evidence,
      })),
    })),
    allowedTransitions: ['assign', 'publish'],
    blockingReasons: [],
  };
  return { detail, assignment, listRow: listRowOf(detail) };
}

export function listRowOf(detail: RfqDetail): RfqListRow {
  return {
    rfqId: detail.rfqId,
    reference: detail.reference,
    title: detail.title,
    status: detail.status,
    deadline: detail.deadline,
    round: detail.round,
    lineCount: detail.lines.length,
    invitedCount: detail.suppliers.length,
    respondedCount: detail.suppliers.filter((supplier) => supplier.response === 'responded').length,
    driftedLineCount: detail.lines.filter((line) => line.drift !== null).length,
  };
}

/** The list with one row added or replaced, newest reference first. */
export function withListRow(list: RfqList, row: RfqListRow): RfqList {
  return {
    rfqs: [...list.rfqs.filter((rfq) => rfq.rfqId !== row.rfqId), row].sort((first, second) =>
      second.reference.localeCompare(first.reference),
    ),
  };
}
