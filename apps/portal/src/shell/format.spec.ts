import { describe, expect, it } from 'vitest';

import { formatDate, formatInstantIn, formatInstantUtc, formatMoney } from './format';

describe('portal formatting', () => {
  it('shows an instant in the supplier time zone with its abbreviation, and the same instant in UTC', () => {
    const deadline = '2026-10-15T17:00:00Z';
    expect(formatInstantIn(deadline, 'America/Toronto')).toMatch(/^Thu, Oct\.? 15, 2026, 13:00 EDT$/);
    expect(formatInstantIn(deadline, 'Europe/Paris')).toMatch(/^Thu, Oct\.? 15, 2026, 19:00 (CEST|GMT\+2)$/);
    expect(formatInstantUtc(deadline)).toMatch(/^Thu, Oct\.? 15, 2026, 17:00$/);
  });

  it('keeps an instant near midnight on the day it falls in each zone', () => {
    const instant = '2026-10-16T02:30:00Z';
    expect(formatInstantIn(instant, 'America/Toronto')).toMatch(/Oct\.? 15, 2026, 22:30/);
    expect(formatInstantUtc(instant)).toMatch(/Oct\.? 16, 2026, 02:30/);
  });

  it('writes other currencies with their code and keeps sub-cent prices', () => {
    expect(formatMoney({ amount: '142.00', currency: 'USD' })).toBe('US$142.00');
    expect(formatMoney({ amount: '52.4', currency: 'CAD' })).toBe('$52.40');
    expect(formatMoney({ amount: '0.0425', currency: 'CAD' })).toBe('$0.0425');
  });

  it('shows a calendar date without shifting it into another day', () => {
    expect(formatDate('2026-12-04')).toMatch(/Dec\.? 4, 2026/);
  });
});
