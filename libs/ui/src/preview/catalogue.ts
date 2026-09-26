import { buildCatalogue, englishCatalogue, type ModuleCatalogue } from '@partledger/contracts';

import previewMessages from './preview.json';

/** The shipped English catalogue plus sample labels that only Storybook loads; the apps never import this. */
export const previewCatalogue: ModuleCatalogue = {
  ...englishCatalogue,
  ...buildCatalogue({ preview: previewMessages }),
};
