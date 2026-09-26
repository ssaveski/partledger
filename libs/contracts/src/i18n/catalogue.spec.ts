import { describe, expect, it } from 'vitest';

import {
  buildCatalogue,
  englishCatalogue,
  englishModuleCatalogues,
  formatMessage,
  modulesFromFiles,
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
});
