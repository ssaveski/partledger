import '@partledger/ui/global';

import { translate } from '@partledger/contracts';
import { applyThemePreference, RootErrorBoundary } from '@partledger/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

document.title = translate('pl.common.portalTitle');
applyThemePreference();

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
