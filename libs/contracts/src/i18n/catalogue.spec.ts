import { describe, expect, it } from 'vitest';

import { buildCatalogue, englishCatalogue, translate } from './catalogue';

describe('translation catalogues', () => {
  it('builds the shipped English catalogue', () => {
    expect(translate('pl.common.appName')).toBe('Partledger');
    expect(Object.keys(englishCatalogue).length).toBeGreaterThan(0);
  });

  it('refuses a key that sits outside its module', () => {
    expect(() => buildCatalogue({ rfqs: { 'pl.parts.title': 'Parts' } })).toThrow(/outside module rfqs/);
  });

  it('refuses a key defined by two modules', () => {
    expect(() =>
      buildCatalogue({
        parts: { 'pl.parts.grid.title': 'Parts' },
        'parts.grid': { 'pl.parts.grid.title': 'Parts' },
      }),
    ).toThrow(/defined twice/);
  });

  it('refuses a key that is not a message key', () => {
    expect(() => buildCatalogue({ parts: { title: 'Parts' } })).toThrow();
  });

  it('fails loudly on a missing key', () => {
    expect(() => translate('pl.common.doesNotExist')).toThrow(/Missing message/);
  });
});
