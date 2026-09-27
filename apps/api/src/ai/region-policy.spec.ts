import { describe, expect, it } from 'vitest';

import { checkRegionPolicy } from './region-policy';

describe('the AI region policy', () => {
  it('gives a tenant restricted to the EU the region error for a non-EU provider', () => {
    const restricted = { region: 'eu', regionRestricted: true } as const;
    for (const processingRegion of ['us', 'ca', 'other'] as const) {
      expect(checkRegionPolicy(restricted, processingRegion)).toEqual({
        ok: false,
        error: {
          _tag: 'Unprocessable',
          reason: 'aiRegionNotAllowed',
          params: { tenantRegion: 'eu', processingRegion },
        },
      });
    }
  });

  it('lets a restricted tenant use a provider in its own region, and the local adapter', () => {
    expect(checkRegionPolicy({ region: 'eu', regionRestricted: true }, 'eu').ok).toBe(true);
    expect(checkRegionPolicy({ region: 'ca', regionRestricted: true }, 'ca').ok).toBe(true);
    expect(checkRegionPolicy({ region: 'ca', regionRestricted: true }, 'local').ok).toBe(true);
  });

  it('lets an unrestricted tenant use a provider in any region', () => {
    for (const processingRegion of ['us', 'eu', 'ca', 'other'] as const) {
      expect(checkRegionPolicy({ region: 'eu', regionRestricted: false }, processingRegion).ok).toBe(true);
    }
  });
});
