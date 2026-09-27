import {
  evidenceQueries,
  partQueries,
  rfqAssignmentQuery,
  rfqListQuery,
  rfqModuleQueries,
  supplierQueries,
  type QueryDeclaration,
} from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { declarationViolations } from './registry-rules';

const declarations: readonly QueryDeclaration[] = [
  ...rfqModuleQueries,
  ...partQueries,
  ...supplierQueries,
  ...evidenceQueries,
];

describe('the rfqs module registry', () => {
  it('declares the list and assignment reads beside the key-screen reads, once each', () => {
    const names = rfqModuleQueries.map((declaration) => declaration.name);
    expect(names).toEqual(expect.arrayContaining([rfqListQuery.name, rfqAssignmentQuery.name]));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the read contracts the secondary staff screens use', () => {
  it.each(declarations.map((declaration) => [declaration.name, declaration] as const))(
    '%s follows every registry rule, so the API can serve it unchanged',
    (_name, declaration) => {
      expect(declarationViolations(declaration)).toEqual([]);
    },
  );
});
