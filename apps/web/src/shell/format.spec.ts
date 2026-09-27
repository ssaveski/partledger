import { describe, expect, it } from 'vitest';

import { formatBytes, messageParams } from './format';

describe('server message params', () => {
  it('read a calendar date as the screen shows dates, and flags as text', () => {
    expect(messageParams({ until: '2026-11-30', count: 2, flag: true, asOf: '2026-09-27 06:00 UTC' })).toEqual({
      until: 'Nov 30, 2026',
      count: 2,
      flag: 'true',
      asOf: '2026-09-27 06:00 UTC',
    });
  });
});

describe('file sizes', () => {
  it('use decimal units', () => {
    expect(formatBytes(512)).toBe('512 bytes');
    expect(formatBytes(482_133)).toBe('482.1 kB');
    expect(formatBytes(1_204_551)).toBe('1.2 MB');
  });
});
