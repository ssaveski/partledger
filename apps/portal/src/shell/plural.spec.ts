import { englishCatalogue } from '@partledger/contracts';
import { describe, expect, it } from 'vitest';

import { countKey } from './plural';

describe('counted messages', () => {
  it('use the singular form for one and the plural form for every other count', () => {
    expect(countKey('pl.portal.respond.answeredCount', 1)).toBe('pl.portal.respond.answeredCount.one');
    expect(countKey('pl.portal.respond.answeredCount', 0)).toBe('pl.portal.respond.answeredCount.other');
    expect(countKey('pl.portal.respond.answeredCount', 3)).toBe('pl.portal.respond.answeredCount.other');
  });

  it('have both forms in the catalogue for every counted portal message', () => {
    for (const base of ['pl.portal.respond.answeredCount', 'pl.portal.respond.intro']) {
      expect(Object.hasOwn(englishCatalogue, `${base}.one`), base).toBe(true);
      expect(Object.hasOwn(englishCatalogue, `${base}.other`), base).toBe(true);
    }
  });
});
