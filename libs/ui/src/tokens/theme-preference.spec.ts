import { describe, expect, it } from 'vitest';

import { applyThemePreference, type ThemeEnvironment } from './theme-preference';

/** A stand-in for the document root and the prefers-color-scheme query, whose scheme the test can flip. */
function fakeEnvironment(prefersLight: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: prefersLight,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const environment: ThemeEnvironment = { root: { dataset: {} }, prefersLight: query };
  const changeScheme = (light: boolean) => {
    query.matches = light;
    for (const listener of listeners) {
      listener();
    }
  };
  return { environment, listeners, changeScheme };
}

describe('applying the theme preference', () => {
  it('follows the system colour scheme while the preference is system', () => {
    const { environment, changeScheme } = fakeEnvironment(false);
    applyThemePreference('system', environment);
    expect(environment.root.dataset['theme']).toBe('dark');
    changeScheme(true);
    expect(environment.root.dataset['theme']).toBe('light');
  });

  it('keeps an explicit dark choice when the system colour scheme changes afterwards', () => {
    const { environment, listeners, changeScheme } = fakeEnvironment(false);
    applyThemePreference('system', environment);
    applyThemePreference('dark', environment);
    changeScheme(true);
    expect(environment.root.dataset['theme']).toBe('dark');
    expect(listeners.size).toBe(0);
  });

  it('keeps a single listener when system is applied twice', () => {
    const { environment, listeners } = fakeEnvironment(true);
    applyThemePreference('system', environment);
    applyThemePreference('system', environment);
    expect(listeners.size).toBe(1);
    expect(environment.root.dataset['theme']).toBe('light');
  });
});
