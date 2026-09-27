import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { HomePage } from './routes/home';
import { ApprovalScreen } from './routes/rfqs/approval';
import { ComparisonScreen } from './routes/rfqs/comparison';
import { DetailScreen, detailSearchSchema } from './routes/rfqs/detail';
import { AppShell } from './shell/app-shell';
import { NotFoundPage } from './shell/not-found';
import { ScreenError, ShellError } from './shell/route-error';

const rootRoute = createRootRoute({ component: AppShell, errorComponent: ShellError, notFoundComponent: NotFoundPage });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

const rfqIdSchema = z.uuid();

// A malformed id can never name an RFQ, so it is a missing page rather than a failed read.
function RfqLayout() {
  const { rfqId } = rfqRoute.useParams();
  return rfqIdSchema.safeParse(rfqId).success ? <Outlet /> : <NotFoundPage />;
}

const rfqRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rfqs/$rfqId', component: RfqLayout });

const detailRoute = createRoute({
  getParentRoute: () => rfqRoute,
  path: '/',
  validateSearch: detailSearchSchema,
  component: DetailScreen,
});

const comparisonRoute = createRoute({
  getParentRoute: () => rfqRoute,
  path: 'comparison',
  component: ComparisonScreen,
});

const approvalRoute = createRoute({ getParentRoute: () => rfqRoute, path: 'approval', component: ApprovalScreen });

const routeTree = rootRoute.addChildren([
  homeRoute,
  rfqRoute.addChildren([detailRoute, comparisonRoute, approvalRoute]),
]);

export function createAppRouter() {
  return createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage, defaultErrorComponent: ScreenError });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
