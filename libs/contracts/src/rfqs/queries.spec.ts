import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { rfqFixtureOutputs } from '../fixtures';
import { englishCatalogue } from '../i18n/catalogue';
import {
  approvalReadSchema,
  awardDecisionSchema,
  comparisonLineSchema,
  comparisonCellSchema,
  comparisonCellStates,
  comparisonReadSchema,
  gateCheckIds,
  rfqDetailSchema,
  rfqQueries,
  rfqStatuses,
  supplierResponseStatusSchema,
} from './queries';

const supplierId = '00000000-0000-4000-8000-000000002001';

const quote = {
  quoteId: '00000000-0000-4000-8000-000000005001',
  unitPrice: { amount: '12.50', currency: 'CAD' },
  oneOffCosts: { amount: '0.00', currency: 'CAD' },
  minimumOrderQuantity: 1,
  leadTimeDays: 30,
  validUntil: '2026-12-31',
  normalisedTotal: { amount: '2500.00', currency: 'CAD' },
  buyerRecorded: false,
};

/** Every message key a value carries, wherever it sits in the tree. */
function messageKeysIn(value: unknown): string[] {
  if (typeof value === 'string') {
    return /^pl\.[a-z]+\./.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(messageKeysIn);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap(messageKeysIn);
  }
  return [];
}

describe('the RFQ read contracts', () => {
  it('parse every fixture the key screens show', () => {
    for (const output of rfqFixtureOutputs.details) {
      expect(rfqDetailSchema.safeParse(output).success, output.reference).toBe(true);
    }
    for (const output of rfqFixtureOutputs.comparisons) {
      expect(comparisonReadSchema.safeParse(output).success, output.reference).toBe(true);
    }
    for (const output of rfqFixtureOutputs.approvals) {
      expect(approvalReadSchema.safeParse(output).success, output.reference).toBe(true);
    }
  });

  it('give an open RFQ no place to carry a supplier answer, only whether the supplier responded', () => {
    const status = {
      supplierId,
      name: 'Northwind Castings',
      linesAssigned: 3,
      response: 'responded',
      respondedAt: '2026-09-25T14:12:00Z',
    };
    expect(supplierResponseStatusSchema.safeParse(status).success).toBe(true);
    expect(supplierResponseStatusSchema.safeParse({ ...status, unitPrice: quote.unitPrice }).success).toBe(false);
    expect(supplierResponseStatusSchema.safeParse({ ...status, quote }).success).toBe(false);
    expect(supplierResponseStatusSchema.safeParse({ ...status, response: 'bestPrice' }).success).toBe(false);
  });

  it('show only responded or not yet as a response status', () => {
    expect(supplierResponseStatusSchema.shape.response.options).toEqual(['responded', 'notYet']);
  });

  it('name exactly seven comparison cell states', () => {
    expect(comparisonCellStates).toEqual([
      'bestPrice',
      'submitted',
      'alternate',
      'noQuote',
      'pending',
      'stale',
      'late',
    ]);
  });

  it('require a quote in a cell exactly when its state carries one', () => {
    const cell = { supplierId, state: 'submitted', quote, alternate: null, noQuoteReason: null };
    expect(comparisonCellSchema.safeParse(cell).success).toBe(true);
    expect(comparisonCellSchema.safeParse({ ...cell, quote: null }).success).toBe(false);
    expect(comparisonCellSchema.safeParse({ ...cell, state: 'pending' }).success).toBe(false);
    expect(comparisonCellSchema.safeParse({ ...cell, state: 'late', quote: null }).success).toBe(true);
    expect(
      comparisonCellSchema.safeParse({ ...cell, state: 'alternate', alternate: null }).success,
      'an alternate cell names the alternate part',
    ).toBe(false);
  });

  it('tie the named lowest supplier to its best-price cell', () => {
    const otherSupplier = '00000000-0000-4000-8000-000000002002';
    const cell = (supplier: string, state: string) => ({
      supplierId: supplier,
      state,
      quote,
      alternate: null,
      noQuoteReason: null,
    });
    const line = {
      lineId: '00000000-0000-4000-8000-000000003001',
      lineNumber: 1,
      partNumber: 'PN-10432',
      revision: 'C',
      description: 'Pump housing, cast aluminium',
      quantity: 200,
      unit: 'each',
      lowestSupplierId: supplierId,
      cells: [cell(supplierId, 'bestPrice'), cell(otherSupplier, 'submitted')],
    };
    expect(comparisonLineSchema.safeParse(line).success).toBe(true);
    expect(comparisonLineSchema.safeParse({ ...line, lowestSupplierId: otherSupplier }).success, 'mismatch').toBe(
      false,
    );
    expect(
      comparisonLineSchema.safeParse({
        ...line,
        cells: [cell(supplierId, 'bestPrice'), cell(otherSupplier, 'bestPrice')],
      }).success,
      'two best prices',
    ).toBe(false);
    expect(
      comparisonLineSchema.safeParse({ ...line, lowestSupplierId: null }).success,
      'best price without lowest',
    ).toBe(false);
    expect(
      comparisonLineSchema.safeParse({ ...line, lowestSupplierId: null, cells: [cell(otherSupplier, 'submitted')] })
        .success,
    ).toBe(true);
  });

  it('let an approval decision name the alternate part its winner offered', () => {
    const packet = rfqFixtureOutputs.approvals.find((output) => output.availability === 'submitted');
    const decision = packet?.availability === 'submitted' ? packet.decisions[0] : undefined;
    const alternate = { partNumber: 'PN-31006-N2', acceptedByQuality: true };
    expect(awardDecisionSchema.safeParse({ ...decision, alternate }).success).toBe(true);
    expect(awardDecisionSchema.safeParse({ ...decision, alternate: { ...alternate, note: 'x' } }).success).toBe(false);
  });

  it('hide the answers of an RFQ that has not closed', () => {
    const notYetClosed = rfqFixtureOutputs.comparisons.filter((output) => output.availability === 'notYetClosed');
    expect(notYetClosed.length).toBeGreaterThan(0);
    const withAnswers = { ...notYetClosed[0], lines: [] };
    expect(comparisonReadSchema.safeParse(withAnswers).success).toBe(false);
  });

  it('have an English message for every key the fixtures carry and every state the screens name', () => {
    const keys = [
      ...messageKeysIn(rfqFixtureOutputs),
      ...comparisonCellStates.map((state) => `pl.rfqs.cellState.${state}`),
      ...gateCheckIds.map((check) => `pl.rfqs.approval.check.${check}`),
      ...gateCheckIds.map((check) => `pl.rfqs.gate.${check}.passed`),
      ...rfqStatuses.map((status) => `pl.rfqs.status.${status}`),
    ];
    const missing = keys.filter((key) => !Object.hasOwn(englishCatalogue, key));
    expect(missing).toEqual([]);
  });

  it('are declared as described rfqs queries', () => {
    for (const declaration of rfqQueries) {
      expect(declaration.name).toMatch(/^rfqs\.[a-z][a-zA-Z]+$/);
      expect(declaration.output.description).toBeDefined();
      for (const field of Object.values(declaration.input.shape)) {
        expect(z.globalRegistry.get(field)?.description).toBeDefined();
      }
      expect(Object.keys(declaration.access)).toEqual(['person']);
    }
  });
});
