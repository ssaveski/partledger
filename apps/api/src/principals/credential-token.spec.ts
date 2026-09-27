import { generateCredentialSecret } from '@partledger/db';
import { describe, expect, it } from 'vitest';

import { acceptsCredentialKind } from '../listeners/entry-adapters';
import { formatCredentialToken, parseAuthorizationHeader } from './credential-token';

const id = '3f6c1d2e-8a9b-4c7d-9e0f-1a2b3c4d5e6f';

describe('credential tokens', () => {
  it('round-trip every kind through the Authorization header', () => {
    const secret = generateCredentialSecret();
    for (const kind of ['staff_session', 'supplier_link', 'drop_credential', 'platform_operator'] as const) {
      expect(parseAuthorizationHeader(`Bearer ${formatCredentialToken(kind, id, secret)}`)).toEqual({
        kind,
        id,
        secret,
      });
    }
  });

  it('use the supplier-link shape plk_<id>_<secret>', () => {
    expect(formatCredentialToken('supplier_link', id, 'a'.repeat(43))).toBe(`plk_${id}_${'a'.repeat(43)}`);
  });

  it('refuse a missing, malformed or unknown-prefix header', () => {
    const secret = generateCredentialSecret();
    for (const header of [
      undefined,
      '',
      `pls_${id}_${secret}`,
      `Basic pls_${id}_${secret}`,
      `Bearer plx_${id}_${secret}`,
      `Bearer pls_${id}_${secret.slice(1)}`,
      `Bearer pls_${id.toUpperCase()}_${secret}`,
      `Bearer pls_${id}_${secret} `,
    ]) {
      expect(parseAuthorizationHeader(header)).toBeNull();
    }
  });

  it('are accepted only by the listener of their own kind', () => {
    expect(acceptsCredentialKind('staff', 'staff_session')).toBe(true);
    expect(acceptsCredentialKind('staff', 'supplier_link')).toBe(false);
    expect(acceptsCredentialKind('portal', 'staff_session')).toBe(false);
    expect(acceptsCredentialKind('drop', 'drop_credential')).toBe(true);
    expect(acceptsCredentialKind('operator', 'staff_session')).toBe(false);
  });
});
