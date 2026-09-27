import { describe, expect, it } from 'vitest';

import { fixtureRfqIds, rfqFixtureOutputs } from '../fixtures';
import { englishCatalogue } from '../i18n/catalogue';
import { rfqAssignmentQuery, rfqAssignmentSchema } from './assignment';
import { rfqDetailSchema, rfqListQuery, rfqListSchema } from './queries';

const assignments = rfqFixtureOutputs.assignments.map((output) => rfqAssignmentSchema.parse(output));
const details = rfqFixtureOutputs.details.map((output) => rfqDetailSchema.parse(output));

describe('the RFQ list contract', () => {
  it('parses the synthetic list, whose rows agree with each RFQ detail', () => {
    const list = rfqListSchema.parse(rfqFixtureOutputs.list);
    expect(list.rfqs.map((row) => row.rfqId).sort()).toEqual(details.map((detail) => detail.rfqId).sort());
    for (const row of list.rfqs) {
      const detail = details.find((candidate) => candidate.rfqId === row.rfqId);
      expect(row.lineCount).toBe(detail?.lines.length);
      expect(row.invitedCount).toBe(detail?.suppliers.length);
      expect(row.driftedLineCount).toBe(detail?.lines.filter((line) => line.drift !== null).length);
    }
  });

  it('counts responses but has no place for what a supplier answered', () => {
    const [row] = rfqFixtureOutputs.list.rfqs;
    expect(rfqListSchema.safeParse({ rfqs: [{ ...row, lowestTotal: '10.00' }] }).success).toBe(false);
  });

  it('is a described rfqs query without input', () => {
    expect(rfqListQuery.name).toBe('rfqs.list');
    expect(rfqListQuery.input.safeParse({}).success).toBe(true);
  });
});

describe('RFQ lines', () => {
  it('flag drift only on the lines of an open RFQ, naming what changed', () => {
    for (const detail of details) {
      const drifted = detail.lines.filter((line) => line.drift !== null);
      if (detail.status !== 'published') {
        expect(drifted, detail.reference).toEqual([]);
      }
    }
    const open = details.find((detail) => detail.rfqId === fixtureRfqIds.open);
    const drifted = open?.lines.filter((line) => line.drift !== null) ?? [];
    expect(drifted.map((line) => line.partNumber)).toEqual(['PN-20877']);
    expect(drifted[0]?.drift?.changes).toEqual([{ field: 'revision', snapshot: 'B', current: 'C' }]);
  });

  it('keep the published snapshot when the part drifts', () => {
    const open = details.find((detail) => detail.rfqId === fixtureRfqIds.open);
    expect(open?.lines.find((line) => line.partNumber === 'PN-20877')?.revision).toBe('B');
  });

  it('refuse quantity breaks that are not whole quantities above zero', () => {
    const [detail] = rfqFixtureOutputs.details;
    const [line] = detail?.lines ?? [];
    const withBreaks = (quantityBreaks: unknown) => ({ ...detail, lines: [{ ...line, quantityBreaks }] });
    expect(rfqDetailSchema.safeParse(withBreaks([100, 500])).success).toBe(true);
    expect(rfqDetailSchema.safeParse(withBreaks([0])).success).toBe(false);
    expect(rfqDetailSchema.safeParse(withBreaks([1.5])).success).toBe(false);
  });
});

describe('the supplier assignment contract', () => {
  it('parses an assignment for every synthetic RFQ', () => {
    expect(assignments).toHaveLength(details.length);
  });

  it('invites each supplier to as many lines as the RFQ detail says', () => {
    for (const assignment of assignments) {
      const detail = details.find((candidate) => candidate.rfqId === assignment.rfqId);
      for (const supplier of detail?.suppliers ?? []) {
        const lines = assignment.lines.filter((line) =>
          line.candidates.some((candidate) => candidate.supplierId === supplier.supplierId && candidate.assigned),
        );
        expect(lines.length, `${assignment.reference} ${supplier.name}`).toBe(supplier.linesAssigned);
      }
    }
  });

  it('marks suppliers outside a line approved scope, including ones already invited', () => {
    const open = assignments.find((assignment) => assignment.rfqId === fixtureRfqIds.open);
    const castings = open?.lines.find((line) => line.category === 'castings');
    const outside = castings?.candidates.filter((candidate) => !candidate.inScope).map((candidate) => candidate.name);
    expect(outside).toContain('Kestrel Machining');
    expect(castings?.candidates.find((candidate) => candidate.name === 'Northwind Castings')?.inScope).toBe(true);
    expect(castings?.candidates.some((candidate) => !candidate.inScope && candidate.assigned)).toBe(true);
  });

  it('lets only a draft be assigned and published', () => {
    for (const assignment of assignments) {
      const draft = assignment.status === 'draft';
      expect(assignment.allowedTransitions.includes('publish'), assignment.reference).toBe(draft);
    }
  });

  it('is a described rfqs query keyed by the RFQ, with English messages for its blocking reasons', () => {
    expect(rfqAssignmentQuery.name).toBe('rfqs.assignment');
    const keys = assignments.flatMap((assignment) => assignment.blockingReasons.map((reason) => reason.message));
    expect(keys.filter((key) => !Object.hasOwn(englishCatalogue, key))).toEqual([]);
  });
});
