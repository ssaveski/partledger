import { describe, expect, it } from 'vitest';

import { adapterKindFrom } from './api-client';

describe('choosing the API adapter', () => {
  it('uses the HTTP adapter only when the build asks for it, and the fixtures otherwise', () => {
    expect(adapterKindFrom('http')).toBe('http');
    expect(adapterKindFrom('fixture')).toBe('fixture');
    expect(adapterKindFrom(undefined)).toBe('fixture');
    expect(adapterKindFrom('HTTP')).toBe('fixture');
  });
});
