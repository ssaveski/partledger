import { describe, expect, it } from 'vitest';

import { inputFingerprint, sortedJson, UnfingerprintableInputError } from './fingerprint';

describe('input fingerprints', () => {
  it('ignore key order', () => {
    expect(sortedJson({ b: 1, a: [{ d: true, c: null }] })).toBe('{"a":[{"c":null,"d":true}],"b":1}');
    expect(inputFingerprint('notes.create', { a: 1, b: 2 })).toEqual(inputFingerprint('notes.create', { b: 2, a: 1 }));
  });

  it('differ for another input or another command', () => {
    const fingerprint = inputFingerprint('notes.create', { title: 'Bracket' });
    expect(inputFingerprint('notes.create', { title: 'Bracket 2' })).not.toEqual(fingerprint);
    expect(inputFingerprint('notes.rename', { title: 'Bracket' })).not.toEqual(fingerprint);
    expect(fingerprint).toHaveLength(32);
  });

  it('differ for two different dates', () => {
    expect(inputFingerprint('rfqs.extend', { deadline: new Date('2026-10-01T00:00:00Z') })).not.toEqual(
      inputFingerprint('rfqs.extend', { deadline: new Date('2026-10-02T00:00:00Z') }),
    );
    expect(sortedJson({ deadline: new Date('2026-10-01T00:00:00Z') })).toBe('{"deadline":"2026-10-01T00:00:00.000Z"}');
  });

  it('refuse values that have no faithful JSON form', () => {
    class Quantity {
      readonly amount = 3;
    }
    for (const value of [
      new Map([['a', 1]]),
      new Set([1]),
      new Quantity(),
      () => 1,
      10n,
      Symbol('part'),
      Number.NaN,
      new Date('not a date'),
    ]) {
      expect(() => inputFingerprint('notes.create', { value })).toThrow(UnfingerprintableInputError);
    }
  });
});
