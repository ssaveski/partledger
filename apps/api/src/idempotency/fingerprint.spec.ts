import { describe, expect, it } from 'vitest';

import { inputFingerprint, sortedJson } from './fingerprint';

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
});
