import { reviewQueueSchema, rfqListSchema, supplierListSchema } from '@partledger/contracts';
import { evidenceFixtureOutputs, rfqFixtureOutputs, supplierFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { closingNext, dashboardCounts, evidenceCounts, suppliersNeedingAttention } from './dashboard-summary';

const rfqs = rfqListSchema.parse(rfqFixtureOutputs.list);

describe('the overview', () => {
  it('counts open RFQs, awards awaiting approval and open lines whose part changed', () => {
    expect(dashboardCounts(rfqs)).toEqual({ open: 1, awaitingApproval: 2, driftedLines: 1 });
  });

  it('lists open RFQs by the deadline that comes first', () => {
    const later = { ...rfqs.rfqs[1], rfqId: '00000000-0000-4000-8000-000000009990', reference: 'RFQ-1060' };
    const earlier = { ...later, rfqId: '00000000-0000-4000-8000-000000009991', deadline: '2026-10-01T16:00:00Z' };
    const list = rfqListSchema.parse({ rfqs: [...rfqs.rfqs, later, earlier] });
    expect(closingNext(list).map((rfq) => rfq.deadline)).toEqual([
      '2026-10-01T16:00:00Z',
      '2026-10-09T16:00:00Z',
      '2026-10-09T16:00:00Z',
    ]);
  });

  it('names the suppliers whose approval or evidence has expired or ends soon', () => {
    const suppliers = supplierListSchema.parse(supplierFixtureOutputs.list);
    expect(suppliersNeedingAttention(suppliers).map((supplier) => supplier.name)).toEqual([
      'Birchfield Precision',
      'Halden Electronics',
      'Kestrel Machining',
    ]);
  });

  it('counts expiring documents among those awaiting confirmation only, and gaps without a deviation', () => {
    const queue = reviewQueueSchema.parse(evidenceFixtureOutputs.reviewQueue);
    expect(evidenceCounts(queue)).toEqual({ awaiting: 5, awaitingExpiring: 1, uncovered: 2 });
  });
});
