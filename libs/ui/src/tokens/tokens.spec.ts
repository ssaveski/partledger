import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readThemePreference, resolveTheme } from './theme-preference';

const source = join(import.meta.dirname, '..');

function componentFiles(): string[] {
  return ['components', 'states']
    .flatMap((directory) => readdirSync(join(source, directory)).map((name) => join(source, directory, name)))
    .filter((path) => path.endsWith('.tsx'));
}

describe('design tokens', () => {
  it('keeps raw colour values out of components', () => {
    const offenders = componentFiles().filter((path) =>
      /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('follows the system colour scheme until a theme is chosen', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('treats a stored preference it does not recognise as the system preference', () => {
    expect(readThemePreference({ getItem: () => 'sepia' })).toBe('system');
    expect(readThemePreference({ getItem: () => null })).toBe('system');
    expect(readThemePreference({ getItem: () => 'light' })).toBe('light');
  });
});
