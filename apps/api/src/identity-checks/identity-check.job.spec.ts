import { describe, expect, it } from 'vitest';

import { checkOutcome, identityCheckJob, maximumCheckAttempts } from './identity-check.job';

const unreachable = { kind: 'unreachable' } as const;

describe('one identity check attempt', () => {
  it('writes nothing and asks again when the register does not answer the first time', () => {
    expect(checkOutcome(unreachable, 1, false, 'Synthetic AB')).toEqual({ kind: 'retry' });
  });

  it('keeps asking until the last attempt', () => {
    expect(checkOutcome(unreachable, maximumCheckAttempts - 1, false, 'Synthetic AB')).toEqual({ kind: 'retry' });
  });

  it('records "not checked" on the last attempt when the register never answered about the identifier', () => {
    expect(checkOutcome(unreachable, maximumCheckAttempts, false, 'Synthetic AB')).toEqual({
      kind: 'record',
      result: 'notChecked',
    });
  });

  it('keeps an earlier result on the last attempt, so an outage never hides it', () => {
    expect(checkOutcome(unreachable, maximumCheckAttempts, true, 'Synthetic AB')).toEqual({ kind: 'keepPrevious' });
  });

  it('records an answer on any attempt', () => {
    expect(checkOutcome({ kind: 'found', registeredName: 'SYNTHETIC AB' }, 1, true, 'Synthetic')).toEqual({
      kind: 'record',
      result: 'verified',
    });
    expect(checkOutcome({ kind: 'notFound' }, 2, false, 'Synthetic')).toEqual({ kind: 'record', result: 'notFound' });
  });

  it('is retried by pg-boss beyond the last attempt, so the last attempt always runs', () => {
    expect(identityCheckJob.retryLimit).toBeGreaterThan(maximumCheckAttempts);
  });
});
