import { describe, expect, it } from 'vitest';

import { domainError, refuse, versionConflict } from './domain-error';

describe('domain errors', () => {
  it('carry their tag, reason and params', () => {
    expect(domainError('NotFound', 'resource', { resource: 'note' })).toEqual({
      _tag: 'NotFound',
      reason: 'resource',
      params: { resource: 'note' },
    });
  });

  it('are returned as failed results, not thrown', () => {
    expect(refuse('Forbidden', 'notPermitted')).toEqual({
      ok: false,
      error: { _tag: 'Forbidden', reason: 'notPermitted', params: {} },
    });
  });

  it('report a stale expected version as a conflict naming both versions', () => {
    expect(versionConflict(3, 3)).toBeNull();
    expect(versionConflict(2, 3)).toEqual({
      _tag: 'Conflict',
      reason: 'versionMismatch',
      params: { expectedVersion: 2, actualVersion: 3 },
    });
  });
});
