import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';

import { EvidenceScreen } from './routes/evidence';
import { HomePage } from './routes/home';
import { LinkLanding } from './routes/link.$linkId';
import { OutcomeScreen } from './routes/outcome';
import { RespondScreen } from './routes/respond';
import { SubmissionScreen } from './routes/submission';
import { PortalShell } from './shell/portal-shell';
import { NotFoundPage, ScreenError, ShellError } from './shell/route-error';
import { SessionLayout } from './shell/session-layout';

const rootRoute = createRootRoute({
  component: PortalShell,
  errorComponent: ShellError,
  notFoundComponent: NotFoundPage,
});

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage });

const linkRoute = createRoute({ getParentRoute: () => rootRoute, path: '/link/$linkId', component: LinkLanding });

/** Every screen a link opens reads the session first; its path segment is not part of the URL. */
const sessionRoute = createRoute({ getParentRoute: () => rootRoute, id: 'session', component: SessionLayout });

const respondRoute = createRoute({ getParentRoute: () => sessionRoute, path: '/respond', component: RespondScreen });

const submissionRoute = createRoute({
  getParentRoute: () => sessionRoute,
  path: '/submission',
  component: SubmissionScreen,
});

const outcomeRoute = createRoute({ getParentRoute: () => sessionRoute, path: '/outcome', component: OutcomeScreen });

const evidenceRoute = createRoute({ getParentRoute: () => sessionRoute, path: '/evidence', component: EvidenceScreen });

const routeTree = rootRoute.addChildren([
  homeRoute,
  linkRoute,
  sessionRoute.addChildren([respondRoute, submissionRoute, outcomeRoute, evidenceRoute]),
]);

export function createPortalRouter() {
  return createRouter({ routeTree, defaultNotFoundComponent: NotFoundPage, defaultErrorComponent: ScreenError });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createPortalRouter>;
  }
}
