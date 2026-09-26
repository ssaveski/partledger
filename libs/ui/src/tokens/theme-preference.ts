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

/** Sets `data-theme` on the document from the stored preference, following the system while it is `system`. */
export function applyThemePreference(preference: ThemePreference = readThemePreference(window.localStorage)): void {
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const apply = () => {
    document.documentElement.dataset['theme'] = resolveTheme(preference, query.matches);
  };
  apply();
  if (preference === 'system') {
    query.addEventListener('change', apply);
  }
}
