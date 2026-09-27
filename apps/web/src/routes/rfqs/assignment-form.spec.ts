import { rfqAssignmentSchema, rfqDetailSchema, type RfqAssignment, type RfqDetail } from '@partledger/contracts';
import { fixtureRfqIds, fixtureSupplierIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it, vi } from 'vitest';

import {
  assignmentFormFrom,
  assignmentFormSchema,
  canInvite,
  publishedPreview,
  submitAssignment,
} from './assignment-form';

function fixture(rfqId: string) {
  const assignment = rfqFixtureOutputs.assignments.find((output) => output.rfqId === rfqId);
  const detail = rfqFixtureOutputs.details.find((output) => output.rfqId === rfqId);
  return { assignment: rfqAssignmentSchema.parse(assignment), detail: rfqDetailSchema.parse(detail) };
}

const draft = fixture(fixtureRfqIds.draftWithoutSuppliers);

describe('the supplier assignment form', () => {
  it('starts from who the read says is invited', () => {
    const open = fixture(fixtureRfqIds.open).assignment;
    expect(assignmentFormFrom(open).lines[0]?.supplierIds).toEqual([
      fixtureSupplierIds.birchfield,
      fixtureSupplierIds.kestrel,
      fixtureSupplierIds.northwind,
    ]);
  });

  it('saves lines without suppliers, but publishes only when every line has one', () => {
    const values = assignmentFormFrom(draft.assignment);
    expect(assignmentFormSchema(draft.assignment, 'save').safeParse(values).success).toBe(true);
    const publishing = assignmentFormSchema(draft.assignment, 'publish').safeParse(values);
    expect(publishing.success).toBe(false);
    expect(publishing.error?.issues.map((issue) => [issue.path.join('.'), issue.message])).toEqual([
      ['lines.0.supplierIds', 'pl.rfqs.assignment.error.noSupplier'],
      ['lines.1.supplierIds', 'pl.rfqs.assignment.error.noSupplier'],
    ]);
  });

  it('lets a supplier outside the scope be invited under the warn policy but not under block', () => {
    const outside = {
      lines: draft.assignment.lines.map((line) => ({ lineId: line.lineId, supplierIds: [fixtureSupplierIds.arbor] })),
    };
    expect(assignmentFormSchema(draft.assignment, 'publish').safeParse(outside).success).toBe(true);
    const blocking = { ...draft.assignment, outOfScopePolicy: 'block' as const };
    expect(assignmentFormSchema(blocking, 'publish').safeParse(outside).error?.issues[0]?.message).toBe(
      'pl.rfqs.assignment.error.outOfScopeBlocked',
    );
    expect(canInvite('block', false)).toBe(false);
    expect(canInvite('warn', false)).toBe(true);
  });

  it('publishes as an open RFQ whose invited suppliers have not responded yet', () => {
    const values = {
      lines: [
        { lineId: draft.assignment.lines[0]?.lineId ?? '', supplierIds: [fixtureSupplierIds.northwind] },
        {
          lineId: draft.assignment.lines[1]?.lineId ?? '',
          supplierIds: [fixtureSupplierIds.northwind, fixtureSupplierIds.kestrel],
        },
      ],
    };
    const published = publishedPreview(draft.assignment, draft.detail, values);
    const detail = rfqDetailSchema.parse(published.detail);
    expect(detail.status).toBe('published');
    expect(detail.suppliers.map((supplier) => [supplier.name, supplier.linesAssigned, supplier.response])).toEqual([
      ['Kestrel Machining', 1, 'notYet'],
      ['Northwind Castings', 2, 'notYet'],
    ]);
    expect(detail.allowedTransitions).toContain('extendDeadline');
    const assignment = rfqAssignmentSchema.parse(published.assignment);
    expect(assignment.allowedTransitions).toEqual([]);
    expect(assignment.lines[1]?.candidates.filter((candidate) => candidate.assigned)).toHaveLength(2);
  });
});

describe('submitting the assignment', () => {
  const values = assignmentFormFrom(draft.assignment);

  it('fails, saving nothing, when the RFQ cannot be read', async () => {
    const save = vi.fn(() => Promise.resolve());
    const outcome = await submitAssignment('publish', draft.assignment, values, {
      readDetail: () => Promise.resolve({ ok: false, failure: { kind: 'unavailable' } }),
      save,
    });
    expect(outcome).toBe('failed');
    expect(save).not.toHaveBeenCalled();
  });

  it('fails when there is no preview to write to', async () => {
    const outcome = await submitAssignment('save', draft.assignment, values, {
      readDetail: () => Promise.resolve({ ok: true, value: draft.detail }),
      save: null,
    });
    expect(outcome).toBe('failed');
  });

  it('saves the invitations, or publishes them with an open detail', async () => {
    const save = vi.fn<(change: { detail: RfqDetail; assignment: RfqAssignment }) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const dependencies = { readDetail: () => Promise.resolve({ ok: true as const, value: draft.detail }), save };
    expect(await submitAssignment('save', draft.assignment, values, dependencies)).toBe('saved');
    expect(save.mock.lastCall?.[0].detail.status).toBe('draft');
    expect(await submitAssignment('publish', draft.assignment, values, dependencies)).toBe('published');
    expect(save.mock.lastCall?.[0].detail.status).toBe('published');
  });
});
