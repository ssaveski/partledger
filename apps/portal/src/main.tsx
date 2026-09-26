import { translate } from '@partledger/contracts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

document.title = translate('pl.common.portalTitle');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
