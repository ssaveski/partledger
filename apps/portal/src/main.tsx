import '@partledger/ui/global';

import { translate } from '@partledger/contracts';
import { applyThemePreference, RootErrorBoundary, TooltipProvider } from '@partledger/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { adapterKindFrom, ConnectionProvider, createConnection } from './api/connection';
import { createPortalRouter } from './router';
import { supplierUnexpectedErrorKey } from './shell/route-error';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

document.title = translate('pl.common.portalTitle');
try {
  applyThemePreference();
} catch {
  // Without storage the theme follows the system colour scheme.
  applyThemePreference('system');
}

const connection = createConnection(adapterKindFrom(import.meta.env['VITE_API_ADAPTER']));
// Failures are data (see useApiQuery), so retrying is the person's choice through the error state.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
const router = createPortalRouter();

createRoot(container).render(
  <StrictMode>
    <RootErrorBoundary messageKey={supplierUnexpectedErrorKey}>
      <ConnectionProvider connection={connection}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </QueryClientProvider>
      </ConnectionProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
