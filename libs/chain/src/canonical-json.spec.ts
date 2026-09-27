import { describe, expect, it } from 'vitest';

import { CanonicalJsonError, canonicalBytes, canonicalize, isCanonical, parseJson } from './canonical-json.ts';

describe('RFC 8785 canonical JSON', () => {
  it('sorts property names by UTF-16 code units at every level', () => {
    expect(canonicalize({ b: 1, a: { z: true, y: [{ d: 1, c: 2 }] }, A: null })).toBe(
      '{"A":null,"a":{"y":[{"c":2,"d":1}],"z":true},"b":1}',
    );
    // U+10000 is the surrogate pair D800 DC00, which sorts before U+FFFF by code unit.
    expect(canonicalize({ '￿': 1, '\u{10000}': 2 })).toBe('{"\u{10000}":2,"￿":1}');
  });

  it('serialises numbers in their shortest round-trip form', () => {
    // Parsed from text, because the literal 333333333.33333329 cannot be written exactly in code.
    expect(canonicalize(parseJson('[4.50, 1E30, 2e-3, 1e-27, 333333333.33333329, 1e21, 1e-7, -0, 100.0]'))).toBe(
      '[4.5,1e+30,0.002,1e-27,333333333.3333333,1e+21,1e-7,0,100]',
    );
  });

  it('escapes only quotes, backslashes and control characters', () => {
    expect(canonicalize('"\\\u0000\b\t\n\u000b\f\r\u001f\u007f/\u2028é😀')).toBe(
      '"\\"\\\\\\u0000\\b\\t\\n\\u000b\\f\\r\\u001f\u007f/\u2028é😀"',
    );
  });

  it('refuses non-finite numbers and lone surrogates, naming where they are', () => {
    expect(() => canonicalize({ price: Number.NaN })).toThrow(
      new CanonicalJsonError('A number must be finite', '/price'),
    );
    expect(() => canonicalize([1, Number.POSITIVE_INFINITY])).toThrow(CanonicalJsonError);
    expect(() => canonicalize({ 'a/b': ['\ud800'] })).toThrow(
      new CanonicalJsonError('A string must not contain a lone surrogate', '/a~1b/0'),
    );
  });

  it('encodes the canonical text as UTF-8', () => {
    expect([...canonicalBytes({ é: 'x' })]).toEqual([0x7b, 0x22, 0xc3, 0xa9, 0x22, 0x3a, 0x22, 0x78, 0x22, 0x7d]);
  });

  it('keeps a "__proto__" property as an ordinary member when parsing', () => {
    expect(canonicalize(parseJson('{"__proto__": {"b": 1}, "a": 2}'))).toBe('{"__proto__":{"b":1},"a":2}');
  });

  it('recognises canonical text and rejects whitespace, unsorted keys, duplicates and other number forms', () => {
    expect(isCanonical('{"a":1,"b":[true,null]}')).toBe(true);
    expect(isCanonical('{"a": 1}')).toBe(false);
    expect(isCanonical('{"b":1,"a":2}')).toBe(false);
    expect(isCanonical('{"a":1,"a":1}')).toBe(false);
    expect(isCanonical('[1.0]')).toBe(false);
    expect(isCanonical('["\\u0041"]')).toBe(false);
    expect(isCanonical('not json')).toBe(false);
  });
});
