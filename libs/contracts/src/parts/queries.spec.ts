import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { partFixtureOutputs } from '../fixtures';
import { englishCatalogue } from '../i18n/catalogue';
import { partCategories, partListQuery, partListSchema, partSources, partUnits } from './queries';

const part = partFixtureOutputs.list.parts[0];

describe('the parts list contract', () => {
  it('parses the synthetic parts list', () => {
    expect(partListSchema.safeParse(partFixtureOutputs.list).success).toBe(true);
  });

  it('refuses a part with a field the contract does not declare', () => {
    expect(partListSchema.safeParse({ parts: [{ ...part, unitPrice: '12.00' }] }).success).toBe(false);
  });

  it('takes no input, so a read can never name another tenant', () => {
    expect(partListQuery.input.safeParse({}).success).toBe(true);
    expect(partListQuery.input.safeParse({ tenantId: '00000000-0000-4000-8000-000000000001' }).success).toBe(false);
  });

  it('is a described parts query that staff read', () => {
    expect(partListQuery.name).toBe('parts.list');
    expect(partListQuery.output.description).toBeDefined();
    for (const field of Object.values(partListSchema.shape)) {
      expect(z.globalRegistry.get(field)?.description).toBeDefined();
    }
    expect(partListQuery.access).toEqual({ person: ['buyer', 'quality_engineer', 'approver', 'auditor'] });
  });

  it('has an English name for every category, unit and source', () => {
    const keys = [
      ...partCategories.map((category) => `pl.parts.category.${category}`),
      ...partUnits.map((unit) => `pl.parts.unit.${unit}`),
      ...partSources.map((source) => `pl.parts.source.${source}`),
    ];
    expect(keys.filter((key) => !Object.hasOwn(englishCatalogue, key))).toEqual([]);
  });
});
