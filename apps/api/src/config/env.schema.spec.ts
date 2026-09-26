import { describe, expect, it } from 'vitest';

import { InvalidConfigurationError, parseConfig } from './env.schema';

describe('API configuration', () => {
  it('accepts a valid environment', () => {
    expect(parseConfig({ NODE_ENV: 'test', PORT: '3000' })).toEqual({
      NODE_ENV: 'test',
      PORT: 3000,
      HOST: '127.0.0.1',
    });
  });

  it('refuses an invalid PORT and names the field', () => {
    expect(() => parseConfig({ NODE_ENV: 'test', PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => parseConfig({ NODE_ENV: 'test', PORT: '70000' })).toThrow(InvalidConfigurationError);
  });

  it('refuses an unknown NODE_ENV and names the field', () => {
    try {
      parseConfig({ NODE_ENV: 'staging', PORT: '3000' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidConfigurationError);
      expect(error instanceof InvalidConfigurationError ? error.fields : []).toEqual(['NODE_ENV']);
      expect(String(error)).toMatch(/NODE_ENV/);
    }
  });
});
