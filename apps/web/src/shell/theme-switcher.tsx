import {
  applyThemePreference,
  Field,
  FieldLabel,
  readThemePreference,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  storeThemePreference,
  themePreferenceSchema,
  useTranslate,
  type ThemePreference,
} from '@partledger/ui';
import { useState } from 'react';

const preferences: readonly ThemePreference[] = ['system', 'dark', 'light'];

const labelKeys: Readonly<Record<ThemePreference, string>> = {
  system: 'pl.web.theme.system',
  dark: 'pl.web.theme.dark',
  light: 'pl.web.theme.light',
};

function storedPreference(): ThemePreference {
  try {
    return readThemePreference(window.localStorage);
  } catch {
    return 'system';
  }
}

/** Follows the system colour scheme until the person picks a theme, and remembers the choice. */
export function ThemeSwitcher() {
  const translate = useTranslate();
  const [preference, setPreference] = useState(storedPreference);
  const items = preferences.map((value) => ({ value, label: translate(labelKeys[value]) }));
  return (
    <Field className="flex-row items-center gap-2">
      <Select
        items={items}
        value={preference}
        onValueChange={(value) => {
          const parsed = themePreferenceSchema.safeParse(value);
          if (!parsed.success) {
            return;
          }
          setPreference(parsed.data);
          applyThemePreference(parsed.data);
          try {
            storeThemePreference(window.localStorage, parsed.data);
          } catch {
            // Storage can be unavailable (private windows); the theme still applies to this visit.
          }
        }}
      >
        <FieldLabel className="text-muted">{translate('pl.web.theme.label')}</FieldLabel>
        <SelectTrigger className="h-8 w-40" />
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
