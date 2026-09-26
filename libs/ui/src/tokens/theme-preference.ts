import { z } from 'zod';

import { themeNames, type ThemeName } from './themes';

export const themePreferenceSchema = z.enum([...themeNames, 'system']);

export type ThemePreference = z.infer<typeof themePreferenceSchema>;

const storageKey = 'pl.theme';

export function resolveTheme(preference: ThemePreference, prefersLight: boolean): ThemeName {
  if (preference === 'system') {
    return prefersLight ? 'light' : 'dark';
  }
  return preference;
}

export function readThemePreference(storage: Pick<Storage, 'getItem'>): ThemePreference {
  const parsed = themePreferenceSchema.safeParse(storage.getItem(storageKey));
  return parsed.success ? parsed.data : 'system';
}

export function storeThemePreference(storage: Pick<Storage, 'setItem'>, preference: ThemePreference): void {
  storage.setItem(storageKey, preference);
}

export interface ColourSchemeQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ThemeEnvironment {
  root: { dataset: DOMStringMap };
  prefersLight: ColourSchemeQuery;
}

function browserEnvironment(): ThemeEnvironment {
  return { root: document.documentElement, prefersLight: window.matchMedia('(prefers-color-scheme: light)') };
}

let stopFollowingSystem: (() => void) | undefined;

/** Sets `data-theme` on the document, following the system colour scheme only while the preference is `system`. */
export function applyThemePreference(
  preference: ThemePreference = readThemePreference(window.localStorage),
  environment: ThemeEnvironment = browserEnvironment(),
): void {
  const { root, prefersLight } = environment;
  stopFollowingSystem?.();
  stopFollowingSystem = undefined;
  const apply = () => {
    root.dataset['theme'] = resolveTheme(preference, prefersLight.matches);
  };
  apply();
  if (preference === 'system') {
    prefersLight.addEventListener('change', apply);
    stopFollowingSystem = () => {
      prefersLight.removeEventListener('change', apply);
    };
  }
}
