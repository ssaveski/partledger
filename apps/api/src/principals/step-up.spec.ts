import { describe, expect, it } from 'vitest';

import type { PersonPrincipal } from './principal';
import { hasRecentStepUp, type StepUpPolicy } from './step-up';

const now = new Date('2026-09-27T12:00:00.000Z');
const policy: StepUpPolicy = { level: 'step-up', freshnessMilliseconds: 300_000 };

function person(stepUp: PersonPrincipal['stepUp']): PersonPrincipal {
  return {
    type: 'person',
    tenantId: '0d7f5a8e-3b1c-4c3e-9a51-2f6d8e4b1a01',
    userId: '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    roles: ['approver'],
    stepUp,
    actedUnder: { grant: 'staff_session', credentialId: '5e3b9c2d-1a4f-4e8b-8c7d-3f2a1b0c9d03' },
    adapter: 'staff',
    correlationId: '2c9a7e14-8f6b-4d2a-b5c3-9e1f0a7d6b02',
  };
}

function secondsAgo(seconds: number): Date {
  return new Date(now.getTime() - seconds * 1000);
}

describe('the step-up check', () => {
  it('accepts the configured level authenticated within the freshness window', () => {
    expect(hasRecentStepUp(person({ level: 'step-up', authenticatedAt: secondsAgo(10) }), now, policy)).toBe(true);
    expect(hasRecentStepUp(person({ level: 'step-up', authenticatedAt: secondsAgo(300) }), now, policy)).toBe(true);
  });

  it('refuses a session without the required level, whatever its time', () => {
    expect(hasRecentStepUp(person(null), now, policy)).toBe(false);
    expect(hasRecentStepUp(person({ level: 'sign-in', authenticatedAt: secondsAgo(1) }), now, policy)).toBe(false);
  });

  it('refuses a step-up older than the freshness window', () => {
    expect(hasRecentStepUp(person({ level: 'step-up', authenticatedAt: secondsAgo(301) }), now, policy)).toBe(false);
  });

  it('tolerates a few seconds of clock skew but refuses a step-up dated further in the future', () => {
    expect(hasRecentStepUp(person({ level: 'step-up', authenticatedAt: secondsAgo(-4) }), now, policy)).toBe(true);
    expect(hasRecentStepUp(person({ level: 'step-up', authenticatedAt: secondsAgo(-60) }), now, policy)).toBe(false);
  });
});
