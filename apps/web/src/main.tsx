import '@partledger/ui/global';

import { translate } from '@partledger/contracts';
import { applyThemePreference, RootErrorBoundary, TooltipProvider } from '@partledger/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { adapterKindFrom, ApiProvider, createClient } from './api/api-client';
import { createPreviewStore } from './api/preview';
import { createAppRouter } from './router';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

document.title = translate('pl.common.staffAppTitle');
try {
  applyThemePreference();
} catch {
  // Without storage the theme follows the system colour scheme.
  applyThemePreference('system');
}

const adapterKind = adapterKindFrom(import.meta.env['VITE_API_ADAPTER']);
const preview = adapterKind === 'fixture' ? createPreviewStore() : null;
const client = createClient(adapterKind, preview);
// Failures are data (see useApiQuery), so retrying is the person's choice through the error state.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
const router = createAppRouter();

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary>
      <ApiProvider client={client} kind={adapterKind} preview={preview}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </QueryClientProvider>
      </ApiProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
