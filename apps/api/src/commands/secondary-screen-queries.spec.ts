import {
  evidenceQueries,
  partQueries,
  rfqAssignmentQuery,
  rfqListQuery,
  supplierQueries,
  type QueryDeclaration,
} from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { declarationViolations } from './registry-rules';

const declarations: readonly QueryDeclaration[] = [
  rfqListQuery,
  rfqAssignmentQuery,
  ...partQueries,
  ...supplierQueries,
  ...evidenceQueries,
];

describe('the read contracts the secondary staff screens use', () => {
  it.each(declarations.map((declaration) => [declaration.name, declaration] as const))(
    '%s follows every registry rule, so the API can serve it unchanged',
    (_name, declaration) => {
      expect(declarationViolations(declaration)).toEqual([]);
    },
  );
});
