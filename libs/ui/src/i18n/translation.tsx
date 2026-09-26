import { englishCatalogue, formatMessage, type MessageParams, type ModuleCatalogue } from '@partledger/contracts';
import { createContext, useCallback, useContext, type ReactNode } from 'react';

const CatalogueContext = createContext<ModuleCatalogue>(englishCatalogue);

export function TranslationProvider({ catalogue, children }: { catalogue: ModuleCatalogue; children: ReactNode }) {
  return <CatalogueContext value={catalogue}>{children}</CatalogueContext>;
}

export type Translate = (key: string, params?: MessageParams) => string;

/** Every component reads its text through this, so a different catalogue replaces all of it. */
export function useTranslate(): Translate {
  const catalogue = useContext(CatalogueContext);
  return useCallback((key: string, params?: MessageParams) => formatMessage(key, params, catalogue), [catalogue]);
}
