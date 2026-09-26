import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { themes, type Palette } from '../src/tokens/themes.ts';
import { checkPalette, contrastRatio, findTokenDrift, runContrastCheck } from './contrast.ts';

const shippedCss = readFileSync(join(import.meta.dirname, '..', 'src', 'tokens', 'tokens.css'), 'utf8');

describe('contrast check', () => {
  it('measures contrast ratios as WCAG defines them', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
    expect(contrastRatio('#5c656d', '#0e1113')).toBeCloseTo(3.19, 2);
  });

  it('fails muted text of #5c656d on the #0e1113 surface', () => {
    const faint: Palette = { ...themes.dark, 'text-muted': '#5c656d' };
    const failures = checkPalette('dark', faint);
    expect(failures).toContainEqual(
      expect.objectContaining({ foreground: 'text-muted', background: 'surface', kind: 'text', minimum: 4.5 }),
    );
    const css = shippedCss.replace('--pl-text-muted: #9aa4ad;', '--pl-text-muted: #5c656d;');
    expect(runContrastCheck(css, { ...themes, dark: faint })).toContain(
      'dark: text text-muted on surface is 3.19:1, below 4.5:1',
    );
  });

  it('fails a border that drops below 3:1 against a surface', () => {
    const faint: Palette = { ...themes.light, 'border-strong': '#9aa3aa' };
    expect(checkPalette('light', faint)).toContainEqual(
      expect.objectContaining({ foreground: 'border-strong', kind: 'ui', minimum: 3 }),
    );
  });

  it('fails a focus ring that drops below 3:1 against a surface', () => {
    const faint: Palette = { ...themes.dark, 'focus-ring': '#2a3138' };
    expect(checkPalette('dark', faint)).toContainEqual(
      expect.objectContaining({ foreground: 'focus-ring', kind: 'focus', minimum: 3 }),
    );
  });

  it('passes the shipped tokens in both themes', () => {
    expect(checkPalette('dark', themes.dark)).toEqual([]);
    expect(checkPalette('light', themes.light)).toEqual([]);
    expect(runContrastCheck(shippedCss)).toEqual([]);
  });

  it('reports a CSS variable that no longer matches its token', () => {
    const drifted = shippedCss.replace('--pl-accent: #006a73;', '--pl-accent: #00aabb;');
    expect(findTokenDrift(drifted)).toEqual(['light: --pl-accent is #00aabb, expected #006a73']);
  });

  it('reports drift in the light block used before a theme is set', () => {
    const [before, fallback] = shippedCss.split('@media (prefers-color-scheme: light)');
    const drifted = `${before ?? ''}@media (prefers-color-scheme: light)${(fallback ?? '').replace('--pl-surface: #f6f8f9;', '--pl-surface: #ffffff;')}`;
    expect(findTokenDrift(drifted)).toEqual(['light before a theme is set: --pl-surface is #ffffff, expected #f6f8f9']);
  });

  it('runs the gate as a script that fails on a problem', () => {
    expect(runContrastCheck(shippedCss.replace("[data-theme='light'] {", '.unrelated {'))).toContain(
      'light: no theme block in tokens.css',
    );
  });

  it('reports a CSS variable that has no token', () => {
    const extra = shippedCss.replace('--pl-info: #6db0ef;', '--pl-info: #6db0ef;\n  --pl-stray: #123456;');
    expect(findTokenDrift(extra)).toEqual(['dark: --pl-stray is not a token in themes.ts']);
  });
});
