import {
  portalSessionQuery,
  type PortalRfqState,
  type PortalSession,
  type PortalView,
} from '@partledger/contracts/portal';
import { Badge, Mono, useTranslate, type StateTone } from '@partledger/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { EyeOffIcon } from 'lucide-react';
import { createContext, useContext } from 'react';

import { useApiQuery } from '../api/connection';
import { navigationLinkClasses } from './portal-shell';
import { QueryView } from './query-view';

export const viewPaths = {
  respond: '/respond',
  submission: '/submission',
  outcome: '/outcome',
  evidence: '/evidence',
} as const satisfies Readonly<Record<PortalView, string>>;

const stateTones: Readonly<Record<PortalRfqState, StateTone>> = {
  open: 'info',
  closed: 'warning',
  sealed: 'success',
};

const SessionContext = createContext<PortalSession | null>(null);

/** The session the surrounding layout read; every screen under it can rely on one. */
export function usePortalSession(): PortalSession {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error('Portal screens render inside the session layout');
  }
  return session;
}

/**
 * Every screen behind a link: reads what the session opens, names the supplier, the buyer and
 * the RFQ, and links the screens the server allows now. Without a session it shows that the link
 * is no longer available.
 */
export function SessionLayout() {
  const query = useApiQuery(portalSessionQuery, {});
  return (
    <QueryView query={query} titleKey="pl.portal.session.title" loadingKey="pl.portal.session.loading">
      {(session) => (
        <SessionContext value={session}>
          <SessionHeader session={session} />
          <Outlet />
        </SessionContext>
      )}
    </QueryView>
  );
}

function SessionHeader({ session }: { session: PortalSession }) {
  const translate = useTranslate();
  return (
    <div className="flex flex-col gap-3 border-b border-line pb-4">
      <p className="text-sm text-muted">
        {translate('pl.portal.session.forSupplier', { supplier: session.supplierName, buyer: session.buyerName })}
      </p>
      {session.rfq === null ? null : (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Mono>{session.rfq.reference}</Mono>
          <span>{session.rfq.title}</span>
          <Badge tone={stateTones[session.rfq.state]}>{translate(`pl.portal.rfqState.${session.rfq.state}`)}</Badge>
        </p>
      )}
      {session.views.length > 1 ? (
        <nav aria-label={translate('pl.portal.session.navigation')}>
          <ul className="-ml-2 flex flex-wrap gap-1">
            {session.views.map((view) => (
              <li key={view}>
                <Link to={viewPaths[view]} className={navigationLinkClasses}>
                  {translate(`pl.portal.view.${view}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <p className="flex max-w-prose items-start gap-2 text-sm text-muted">
        <EyeOffIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
        {translate('pl.portal.session.ownLinesOnly')}
      </p>
    </div>
  );
}
