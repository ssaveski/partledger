import { z } from 'zod';

import common from './en/common.json' with { type: 'json' };

export const messageKeyPattern = /^pl\.[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9.]*$/;

const moduleCatalogueSchema = z.record(z.string().regex(messageKeyPattern), z.string().min(1));

export type ModuleCatalogue = z.infer<typeof moduleCatalogueSchema>;

/**
 * One catalogue per module (KTD38), so parallel units never edit the same file.
 * Every key in a module's catalogue must start with `pl.<module>.`.
 */
export const englishModuleCatalogues: Readonly<Record<string, unknown>> = {
  common,
};

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
  const message = catalogue[key];
  if (message === undefined) {
    throw new Error(`Missing message for key ${key}`);
  }
  return message;
}
