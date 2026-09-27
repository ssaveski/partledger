import { comparisonReadSchema, type QuoteComparison } from '@partledger/contracts';
import { fixtureRfqIds, rfqFixtureOutputs } from '@partledger/contracts/fixtures';
import { describe, expect, it } from 'vitest';

import { awardFormSchema, emptyAwardForm, noAward, requiresJustification, winnerOptions } from './award-form';

function closedComparison(): QuoteComparison {
  const output = rfqFixtureOutputs.comparisons.find((candidate) => candidate.rfqId === fixtureRfqIds.closed);
  const parsed = comparisonReadSchema.parse(output);
  if (parsed.availability !== 'available') {
    throw new Error('The closed RFQ has a comparison');
  }
  return parsed;
}

const comparison = closedComparison();

function line(lineNumber: number) {
  const found = comparison.lines.find((candidate) => candidate.lineNumber === lineNumber);
  if (found === undefined) {
    throw new Error(`No line ${lineNumber}`);
  }
  return found;
}

function supplierId(name: string): string {
  const found = comparison.suppliers.find((supplier) => supplier.name === name);
  if (found === undefined) {
    throw new Error(`No supplier ${name}`);
  }
  return found.supplierId;
}

function issuesFor(decisions: { winner: string; justification: string }[]) {
  const form = {
    decisions: comparison.lines.map((each, index) => ({
      lineId: each.lineId,
      winner: decisions[index]?.winner ?? noAward,
      justification: decisions[index]?.justification ?? '',
    })),
  };
  const result = awardFormSchema(comparison.lines).safeParse(form);
  return result.success ? [] : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

describe('the award form', () => {
  it('starts with no winner on any line, whatever is lowest', () => {
    expect(emptyAwardForm(comparison.lines).decisions.map((decision) => decision.winner)).toEqual(['', '', '', '', '']);
  });

  it('asks for a winner or no award on every line', () => {
    const result = awardFormSchema(comparison.lines).safeParse(emptyAwardForm(comparison.lines));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      Array.from({ length: 5 }, () => 'pl.rfqs.award.error.winnerRequired'),
    );
  });

  it('needs a justification for a winner that is not the lowest total', () => {
    expect(issuesFor([{ winner: supplierId('Northwind Castings'), justification: '' }])).toEqual([
      { path: ['decisions', 0, 'justification'], message: 'pl.rfqs.award.error.justificationRequired' },
    ]);
    expect(issuesFor([{ winner: supplierId('Northwind Castings'), justification: '   ' }])).toHaveLength(1);
    expect(issuesFor([{ winner: supplierId('Northwind Castings'), justification: 'Shorter lead time.' }])).toEqual([]);
  });

  it('needs no justification for the lowest total or for no award', () => {
    expect(issuesFor([{ winner: supplierId('Birchfield Precision'), justification: '' }])).toEqual([]);
    expect(issuesFor([{ winner: noAward, justification: '' }])).toEqual([]);
    expect(requiresJustification(line(1), '')).toBe(false);
  });

  it('offers only current quotes and accepted alternates as winners', () => {
    const names = (lineNumber: number) =>
      winnerOptions(line(lineNumber), comparison.suppliers).map((option) => option.name);
    expect(names(2)).toEqual(['Northwind Castings']);
    expect(names(3)).toEqual(['Birchfield Precision', 'Arbor Fasteners']);
    expect(names(5)).toEqual(['Birchfield Precision', 'Arbor Fasteners']);
    expect(winnerOptions(line(5), comparison.suppliers).find((option) => option.alternate)?.name).toBe(
      'Arbor Fasteners',
    );
  });

  it('marks the lowest total among the winner options', () => {
    const lowest = winnerOptions(line(1), comparison.suppliers).filter((option) => option.lowest);
    expect(lowest.map((option) => [option.name, option.total.amount])).toEqual([['Birchfield Precision', '10880.00']]);
  });
});
