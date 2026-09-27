import { describe, expect, it } from 'vitest';

import { approvalReadSchema, comparisonReadSchema, type ComparisonCell, type QuoteComparison } from '../rfqs/queries';
import { rfqFixtureOutputs } from './rfqs';

const comparisons = rfqFixtureOutputs.comparisons
  .map((output) => comparisonReadSchema.parse(output))
  .flatMap((read): QuoteComparison[] => (read.availability === 'available' ? [read] : []));

const packets = rfqFixtureOutputs.approvals
  .map((output) => approvalReadSchema.parse(output))
  .flatMap((read) => (read.availability === 'submitted' ? [read] : []));

// Stale answers belong to an earlier version of the line, so they never compete.
function isCurrentQuote(cell: ComparisonCell): boolean {
  return cell.quote !== null && cell.state !== 'stale';
}

function total(cell: ComparisonCell): number {
  return Number(cell.quote?.normalisedTotal.amount);
}

describe('the synthetic RFQ fixtures', () => {
  it('mark as best price the cell holding the lowest normalised total among current quotes, and name its supplier as lowest', () => {
    expect(comparisons.length).toBeGreaterThan(0);
    for (const comparison of comparisons) {
      for (const line of comparison.lines) {
        const current = line.cells.filter(isCurrentQuote);
        const best = line.cells.filter((cell) => cell.state === 'bestPrice');
        const where = `${comparison.reference} line ${line.lineNumber}`;
        if (current.length === 0) {
          expect(best, where).toEqual([]);
          expect(line.lowestSupplierId, where).toBeNull();
          continue;
        }
        const minimum = Math.min(...current.map(total));
        expect(best.length, where).toBe(1);
        expect(best[0] === undefined ? Number.NaN : total(best[0]), where).toBe(minimum);
        expect(line.lowestSupplierId, where).toBe(best[0]?.supplierId);
      }
    }
  });

  it('flag an approval decision as lowest exactly when its winner is the lowest total in the comparison', () => {
    expect(packets.length).toBeGreaterThan(0);
    for (const packet of packets) {
      const comparison = comparisons.find((candidate) => candidate.rfqId === packet.rfqId);
      expect(comparison, packet.reference).toBeDefined();
      for (const decision of packet.decisions) {
        const where = `${packet.reference} line ${decision.lineNumber}`;
        const line = comparison?.lines.find((candidate) => candidate.lineId === decision.lineId);
        expect(line, where).toBeDefined();
        if (decision.supplier === null) {
          expect(decision.lowest, where).toBe(false);
          continue;
        }
        const winner = decision.supplier.supplierId;
        const cell = line?.cells.find((candidate) => candidate.supplierId === winner);
        expect(decision.lowest, where).toBe(line?.lowestSupplierId === winner);
        expect(decision.normalisedTotal, where).toEqual(cell?.quote?.normalisedTotal);
        expect(decision.buyerRecorded, where).toBe(cell?.quote?.buyerRecorded);
        expect(decision.alternate, where).toEqual(cell?.alternate ?? null);
        expect(decision.justification === null, where).toBe(decision.lowest);
      }
    }
  });

  it('include an alternate part among the winners', () => {
    expect(packets.flatMap((packet) => packet.decisions).some((decision) => decision.alternate !== null)).toBe(true);
  });

  it('include RFQs closed before and after their deadline', () => {
    expect(comparisons.some((comparison) => comparison.closedAt < comparison.deadline)).toBe(true);
    expect(comparisons.some((comparison) => comparison.closedAt > comparison.deadline)).toBe(true);
  });
});
