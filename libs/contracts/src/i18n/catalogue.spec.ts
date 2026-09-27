import { describe, expect, it } from 'vitest';

import {
  buildCatalogue,
  englishCatalogue,
  englishModuleCatalogues,
  formatMessage,
  modulesFromFiles,
  pluralMessageKey,
  translate,
} from './catalogue';

describe('translation catalogues', () => {
  it('builds the shipped English catalogue', () => {
    expect(translate('pl.common.appName')).toBe('Partledger');
    expect(Object.keys(englishCatalogue).length).toBeGreaterThan(0);
  });

  it('discovers every module catalogue by its file name', () => {
    expect(Object.keys(englishModuleCatalogues)).toContain('common');
    expect(modulesFromFiles({ './en/parts.json': {}, './en/rfqs.json': {} })).toEqual({ parts: {}, rfqs: {} });
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
    expect(() => translate('toString')).toThrow(/Missing message/);
  });

  it('fills the placeholders of a message from its params', () => {
    const catalogue = buildCatalogue({ parts: { 'pl.parts.count': '{count} parts from {supplier}' } });
    expect(formatMessage('pl.parts.count', { count: 3, supplier: 'Northwind Castings' }, catalogue)).toBe(
      '3 parts from Northwind Castings',
    );
  });

  it('fails loudly on a placeholder without a param', () => {
    const catalogue = buildCatalogue({ parts: { 'pl.parts.count': '{count} parts' } });
    expect(() => formatMessage('pl.parts.count', {}, catalogue)).toThrow(/Missing param count/);
  });

  it('fails loudly on a placeholder named after an inherited object property', () => {
    const catalogue = buildCatalogue({ parts: { 'pl.parts.owner': 'Made by {constructor}' } });
    expect(() => formatMessage('pl.parts.owner', {}, catalogue)).toThrow(/Missing param constructor/);
  });

  it('chooses the zero, one or other form of a counted message, falling back to other', () => {
    const catalogue = buildCatalogue({
      parts: {
        'pl.parts.left.zero': 'None left',
        'pl.parts.left.one': 'One left',
        'pl.parts.left.other': '{count} left',
        'pl.parts.seen.other': 'Seen {count} times',
      },
    });
    expect(pluralMessageKey('pl.parts.left', 0, catalogue)).toBe('pl.parts.left.zero');
    expect(pluralMessageKey('pl.parts.left', 1, catalogue)).toBe('pl.parts.left.one');
    expect(pluralMessageKey('pl.parts.left', 7, catalogue)).toBe('pl.parts.left.other');
    expect(pluralMessageKey('pl.parts.seen', 0, catalogue)).toBe('pl.parts.seen.other');
    expect(pluralMessageKey('pl.parts.seen', 1, catalogue)).toBe('pl.parts.seen.other');
  });
});
