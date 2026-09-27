/// <reference types="vite/client" />

import { z } from 'zod';

export const messageKeyPattern = /^pl\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9.]*$/;

const moduleCatalogueSchema = z.record(z.string().regex(messageKeyPattern), z.string().min(1));

export type ModuleCatalogue = z.infer<typeof moduleCatalogueSchema>;

/**
 * One catalogue per module (KTD38), discovered by file name so parallel units never edit
 * the same file: `en/<module>.json` holds keys that start with `pl.<module>.`.
 */
export function modulesFromFiles(files: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const modules: Record<string, unknown> = {};
  for (const [path, catalogue] of Object.entries(files)) {
    const moduleName = /\/([^/]+)\.json$/.exec(path)?.[1];
    if (moduleName === undefined) {
      throw new Error(`Catalogue file ${path} is not named <module>.json`);
    }
    modules[moduleName] = catalogue;
  }
  return modules;
}

export const englishModuleCatalogues = modulesFromFiles(
  import.meta.glob<unknown>('./en/*.json', { eager: true, import: 'default' }),
);

export function buildCatalogue(modules: Readonly<Record<string, unknown>>): ModuleCatalogue {
  const merged: ModuleCatalogue = {};
  for (const [moduleName, raw] of Object.entries(modules)) {
    const catalogue = moduleCatalogueSchema.parse(raw);
    for (const [key, message] of Object.entries(catalogue)) {
      if (!key.startsWith(`pl.${moduleName}.`)) {
        throw new Error(`Message key ${key} is outside module ${moduleName}`);
      }
      if (key in merged) {
        throw new Error(`Message key ${key} is defined twice`);
      }
      merged[key] = message;
    }
  }
  return merged;
}

export const englishCatalogue = buildCatalogue(englishModuleCatalogues);

export function translate(key: string, catalogue: ModuleCatalogue = englishCatalogue): string {
  const message = Object.hasOwn(catalogue, key) ? catalogue[key] : undefined;
  if (message === undefined) {
    throw new Error(`Missing message for key ${key}`);
  }
  return message;
}

export const messageParamsSchema = z.record(z.string(), z.union([z.string(), z.number()]));

export type MessageParams = z.infer<typeof messageParamsSchema>;

/** Translates a key and fills its `{name}` placeholders; a placeholder without a param fails loudly. */
export function formatMessage(
  key: string,
  params: MessageParams = {},
  catalogue: ModuleCatalogue = englishCatalogue,
): string {
  return translate(key, catalogue).replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_placeholder, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (value === undefined) {
      throw new Error(`Missing param ${name} for message key ${key}`);
    }
    return String(value);
  });
}

/**
 * The key for a message that depends on a count: `<base>.zero` for 0 and `<base>.one` for 1
 * when the catalogue has them, otherwise `<base>.other`.
 */
export function pluralMessageKey(
  baseKey: string,
  count: number,
  catalogue: ModuleCatalogue = englishCatalogue,
): string {
  const candidates = [
    ...(count === 0 ? [`${baseKey}.zero`] : []),
    ...(count === 1 ? [`${baseKey}.one`] : []),
    `${baseKey}.other`,
  ];
  return candidates.find((key) => Object.hasOwn(catalogue, key)) ?? baseKey;
}
