import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { z } from 'zod';

import { DashboardPage } from './routes/dashboard';
import { EvidenceReviewScreen } from './routes/evidence/review';
import { PartListScreen } from './routes/parts/list';
import { partListSearchSchema } from './routes/parts/part-filters';
import { ApprovalScreen } from './routes/rfqs/approval';
import { AssignmentScreen } from './routes/rfqs/assignment';
import { ComparisonScreen } from './routes/rfqs/comparison';
import { DetailScreen, detailSearchSchema } from './routes/rfqs/detail';
import { RfqListScreen } from './routes/rfqs/list';
import { NewRfqScreen } from './routes/rfqs/new';
import { rfqListSearchSchema } from './routes/rfqs/rfq-list-filters';
import { SupplierListScreen } from './routes/suppliers/list';
import { supplierListSearchSchema } from './routes/suppliers/supplier-filters';
import { AppShell } from './shell/app-shell';
import { NotFoundPage } from './shell/not-found';
import { ScreenError, ShellError } from './shell/route-error';

const rootRoute = createRootRoute({ component: AppShell, errorComponent: ShellError, notFoundComponent: NotFoundPage });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardPage });

const rfqListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rfqs',
  validateSearch: rfqListSearchSchema,
  component: RfqListScreen,
});

const newRfqRoute = createRoute({ getParentRoute: () => rootRoute, path: '/rfqs/new', component: NewRfqScreen });

const partListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parts',
  validateSearch: partListSearchSchema,
  component: PartListScreen,
});

const supplierListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/suppliers',
  validateSearch: supplierListSearchSchema,
  component: SupplierListScreen,
});

const evidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/evidence',
  component: EvidenceReviewScreen,
});

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

const assignmentRoute = createRoute({
  getParentRoute: () => rfqRoute,
  path: 'assignment',
  component: AssignmentScreen,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  rfqListRoute,
  newRfqRoute,
  partListRoute,
  supplierListRoute,
  evidenceRoute,
  rfqRoute.addChildren([detailRoute, assignmentRoute, comparisonRoute, approvalRoute]),
]);

export function createAppRouter() {
  return createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage, defaultErrorComponent: ScreenError });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
