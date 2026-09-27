import { rfqQueries } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { declarationViolations } from './registry-rules';

describe('the RFQ read contracts the key screens use', () => {
  it.each(rfqQueries.map((declaration) => [declaration.name, declaration] as const))(
    '%s follows every registry rule, so the API can serve it unchanged',
    (_name, declaration) => {
      expect(declarationViolations(declaration)).toEqual([]);
    },
  );
});
