import { describe, expect, it } from 'vitest';

import { matchesText, searchValue } from './text-filter';

describe('a text filter', () => {
  it('matches every record when the query is empty or blank', () => {
    expect(matchesText(undefined, ['PN-10432'])).toBe(true);
    expect(matchesText('   ', ['PN-10432'])).toBe(true);
  });

  it('needs every word somewhere in the fields, ignoring case and accents', () => {
    expect(matchesText('pump ALUMINIUM', ['PN-10432', 'Pump housing, cast aluminium'])).toBe(true);
    expect(matchesText('pump bronze', ['PN-10432', 'Pump housing, cast aluminium'])).toBe(false);
    expect(matchesText('sjoberg', ['Elin Sjöberg'])).toBe(true);
  });

  it('leaves the address when the text is blank', () => {
    expect(searchValue('  ')).toBeUndefined();
    expect(searchValue('pump ')).toBe('pump ');
  });
});
