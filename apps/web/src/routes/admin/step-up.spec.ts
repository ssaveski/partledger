import { describe, expect, it } from 'vitest';

import { resumedChangeOf } from './step-up';

describe('a member change that waited for a step-up', () => {
  it('is nothing when no change was waiting or the page is leaving again', () => {
    expect(resumedChangeOf(null)).toBeNull();
    expect(resumedChangeOf({ kind: 'steppingUp' })).toBeNull();
  });

  it('is done when the server accepted it', () => {
    expect(resumedChangeOf({ kind: 'answered', status: 200, body: { userId: 'synthetic-user' } })).toEqual({
      kind: 'done',
    });
  });

  it('shows the server message key when the server refused it', () => {
    expect(
      resumedChangeOf({
        kind: 'answered',
        status: 409,
        body: { error: 'Conflict', message: 'pl.error.conflict.lastTenantAdmin', params: {} },
      }),
    ).toEqual({ kind: 'failed', messageKey: 'pl.error.conflict.lastTenantAdmin' });
  });

  it('shows the unexpected error when the refusal is not a declared error body', () => {
    expect(resumedChangeOf({ kind: 'answered', status: 502, body: '<html>proxy</html>' })).toEqual({
      kind: 'failed',
      messageKey: 'pl.error.internal.unexpected',
    });
  });

  it('shows why the step-up did not complete', () => {
    expect(resumedChangeOf({ kind: 'stepUpFailed', messageKey: 'pl.auth.stepUpFailed' })).toEqual({
      kind: 'failed',
      messageKey: 'pl.auth.stepUpFailed',
    });
    expect(resumedChangeOf({ kind: 'unavailable', messageKey: 'pl.auth.sessionUnavailable' })).toEqual({
      kind: 'failed',
      messageKey: 'pl.auth.sessionUnavailable',
    });
  });
});
