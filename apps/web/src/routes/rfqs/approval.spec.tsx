import { approvalReadSchema, type AwardDecision } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DecisionCard } from './approval';

function readyDecisions(): AwardDecision[] {
  const packet = approvalReadSchema.parse(
    rfqFixtureOutputs.approvals.find((output) => output.rfqId === fixtureRfqIds.readyApproval),
  );
  if (packet.availability !== 'submitted') {
    throw new Error('The ready RFQ has an approval packet');
  }
  return packet.decisions;
}

function text(decision: AwardDecision): string {
  return renderToStaticMarkup(<DecisionCard decision={decision} />).replace(/<[^>]+>/g, ' ');
}

describe('an approval packet decision', () => {
  it('names the alternate part a winner offered and that quality accepted it', () => {
    const alternate = readyDecisions().find((decision) => decision.alternate !== null);
    expect(alternate).toBeDefined();
    if (alternate !== undefined) {
      expect(text(alternate)).toMatch(/Offers PN-31006-N2.*Accepted by quality/);
    }
  });

  it('says when a winner has no evidence on file or required, instead of showing nothing', () => {
    const [first] = readyDecisions();
    if (first === undefined) {
      throw new Error('The ready packet has decisions');
    }
    expect(text({ ...first, evidence: [] })).toContain('No evidence is on file or required for this supplier.');
  });
});
