import { portalQueries } from '@partledger/contracts/portal';
import { describe, expect, it } from 'vitest';

import { declarationViolations } from './registry-rules';

describe('the portal read contracts the supplier screens use', () => {
  it.each(portalQueries.map((declaration) => [declaration.name, declaration] as const))(
    '%s follows every registry rule, so the API can serve it unchanged',
    (_name, declaration) => {
      expect(declarationViolations(declaration)).toEqual([]);
    },
  );

  it.each(portalQueries.map((declaration) => [declaration.name, declaration] as const))(
    '%s is open to supplier links only, never to staff',
    (_name, declaration) => {
      expect(declaration.access).toEqual({ supplier_token: true });
    },
  );
});
