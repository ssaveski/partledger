import { describe, expect, it } from 'vitest';

import {
  applicableRegisters,
  identitySummary,
  latestChecks,
  namesMatch,
  resultOf,
  type StoredIdentityCheck,
} from './identity-standing';

const lei = '5299000SYNTHETIC0133';

describe('which registers apply', () => {
  it('asks VIES about an EU VAT id and GLEIF about an LEI', () => {
    expect(applicableRegisters({ vatId: 'SE556677889901', lei })).toEqual([
      { register: 'vies', identifier: 'SE556677889901' },
      { register: 'lei', identifier: lei },
    ]);
  });

  it('uses the EL prefix for Greece and XI for Northern Ireland', () => {
    expect(applicableRegisters({ vatId: 'EL123456789', lei: null })).toHaveLength(1);
    expect(applicableRegisters({ vatId: 'XI123456789', lei: null })).toHaveLength(1);
  });

  it('asks no register about a VAT id outside the EU or a supplier without identifiers', () => {
    expect(applicableRegisters({ vatId: 'GB123456789', lei: null })).toEqual([]);
    expect(applicableRegisters({ vatId: null, lei: null })).toEqual([]);
  });
});

describe('name matching', () => {
  it('ignores case, accents, punctuation and legal forms', () => {
    expect(namesMatch('Lindqvist Plåt AB', 'LINDQVIST PLAT AKTIEBOLAG AB')).toBe(true);
    expect(namesMatch('Synthetic Castings Ltd.', 'synthetic castings limited')).toBe(true);
  });

  it('accepts one name whose words all appear in the other', () => {
    expect(namesMatch('Halden', 'Halden Electronics GmbH')).toBe(true);
  });

  it('refuses a different organisation', () => {
    expect(namesMatch('Halden Electronics', 'Kestrel Machining Inc')).toBe(false);
    expect(namesMatch('Halden Electronics', 'GmbH')).toBe(false);
  });
});

describe('the result of an answer', () => {
  it('is verified for a found identifier under a matching or hidden name', () => {
    expect(resultOf({ kind: 'found', registeredName: 'Synthetic AB' }, 'Synthetic')).toBe('verified');
    expect(resultOf({ kind: 'found', registeredName: null }, 'Synthetic')).toBe('verified');
  });

  it('is a mismatch under another name, not found when unregistered, and not checked when unreachable', () => {
    expect(resultOf({ kind: 'found', registeredName: 'Someone Else' }, 'Synthetic')).toBe('mismatch');
    expect(resultOf({ kind: 'notFound' }, 'Synthetic')).toBe('notFound');
    expect(resultOf({ kind: 'unreachable' }, 'Synthetic')).toBe('notChecked');
  });
});

describe('the checks a read shows', () => {
  const supplier = { vatId: 'SE556677889901', lei };
  const at = (time: string) => new Date(time);
  const checks: StoredIdentityCheck[] = [
    { register: 'vies', identifier: 'SE556677889901', result: 'notChecked', checkedAt: at('2026-09-20T03:00:00Z') },
    { register: 'vies', identifier: 'SE556677889901', result: 'verified', checkedAt: at('2026-09-21T03:00:00Z') },
    { register: 'lei', identifier: lei, result: 'mismatch', checkedAt: at('2026-09-19T03:00:00Z') },
    { register: 'lei', identifier: '5299000SYNTHETIC0230', result: 'verified', checkedAt: at('2026-09-25T03:00:00Z') },
  ];

  it('keeps the latest check of each register for the current identifier only', () => {
    expect(latestChecks(supplier, checks)).toEqual([
      { status: 'verified', register: 'vies', checkedAt: '2026-09-21T03:00:00.000Z' },
      { status: 'mismatch', register: 'lei', checkedAt: '2026-09-19T03:00:00.000Z' },
    ]);
  });

  it('reads a register never asked about the current identifier as not checked, with no time', () => {
    expect(latestChecks({ vatId: 'DE123456789', lei: null }, checks)).toEqual([
      { status: 'notChecked', register: 'vies', checkedAt: null },
    ]);
  });

  it('summarises with the least reassuring check, so a mismatch is never hidden', () => {
    expect(identitySummary(supplier, checks)).toEqual({
      status: 'mismatch',
      register: 'lei',
      checkedAt: '2026-09-19T03:00:00.000Z',
    });
  });

  it('summarises a supplier no register applies to as not applicable', () => {
    expect(identitySummary({ vatId: null, lei: null }, checks)).toEqual({
      status: 'notApplicable',
      register: null,
      checkedAt: null,
    });
  });
});
