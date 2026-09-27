import { Button, cn, focusRing, useTranslate } from '@partledger/ui';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { FlaskConicalIcon, LogOutIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useAdapterKind } from '../api/api-client';
import { AlertsMenu } from './alerts';
import { useSession } from './session-provider';
import { holdsRole } from './session-view';
import { ThemeSwitcher } from './theme-switcher';

export const navigationLinkClasses = cn(
  'rounded-md px-2 py-1 text-sm font-medium text-muted hover:text-primary',
  'aria-[current=page]:text-primary aria-[current=page]:underline aria-[current=page]:decoration-accent aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8',
  focusRing,
);

/**
 * The staff app frame: a skip link, the banner with navigation and the theme switcher, and the
 * main region every screen renders into. After a client-side navigation focus moves to the main
 * region, so keyboard and screen-reader users start at the new page rather than the old link.
 */
export function AppShell() {
  const translate = useTranslate();
  const adapterKind = useAdapterKind();
  const { signedIn } = useSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const main = useRef<HTMLElement>(null);
  const previousPathname = useRef(pathname);

  useEffect(() => {
    if (previousPathname.current !== pathname) {
      previousPathname.current = pathname;
      main.current?.focus();
    }
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-surface text-primary">
      <a
        href="#main"
        // Focusing directly keeps the router from treating the fragment as a navigation.
        onClick={(event) => {
          event.preventDefault();
          main.current?.focus();
        }}
        className={cn(
          'sr-only rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50',
          focusRing,
        )}
      >
        {translate('pl.web.skipToContent')}
      </a>
      <header className="border-b border-line bg-surface-raised [--pl-ring-offset:var(--pl-surface-raised)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className={cn('rounded-md text-base font-semibold text-primary', focusRing)}>
              {translate('pl.common.appName')}
            </Link>
            <nav aria-label={translate('pl.web.navigation.label')}>
              <ul className="flex items-center gap-2">
                <li>
                  <Link to="/" activeOptions={{ exact: true }} className={navigationLinkClasses}>
                    {translate('pl.web.navigation.overview')}
                  </Link>
                </li>
                <li>
                  <Link to="/rfqs" className={navigationLinkClasses}>
                    {translate('pl.web.navigation.rfqs')}
                  </Link>
                </li>
                <li>
                  <Link to="/parts" className={navigationLinkClasses}>
                    {translate('pl.web.navigation.parts')}
                  </Link>
                </li>
                <li>
                  <Link to="/suppliers" className={navigationLinkClasses}>
                    {translate('pl.web.navigation.suppliers')}
                  </Link>
                </li>
                <li>
                  <Link to="/evidence" className={navigationLinkClasses}>
                    {translate('pl.web.navigation.evidence')}
                  </Link>
                </li>
                {holdsRole(signedIn, 'tenant_admin') ? (
                  <li>
                    <Link to="/admin/members" className={navigationLinkClasses}>
                      {translate('pl.tenants.shell.navigation.members')}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">
              <span className="sr-only">{translate('pl.tenants.shell.tenantLabel')}: </span>
              {translate('pl.tenants.shell.regionNotice', {
                tenant: signedIn.tenant.displayName,
                region: translate(`pl.tenants.region.${signedIn.tenant.region}`),
              })}
            </p>
            <AlertsMenu />
            <ThemeSwitcher />
            <SignOut />
          </div>
        </div>
        {adapterKind === 'fixture' ? (
          <p className="flex items-center justify-center gap-2 border-t border-line px-6 py-1.5 text-center text-sm text-muted">
            <FlaskConicalIcon aria-hidden className="size-4 text-info" />
            {translate('pl.web.previewNotice')}
          </p>
        ) : null}
      </header>
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-6 outline-hidden"
      >
        <Outlet />
      </main>
    </div>
  );
}

function SignOut() {
  const translate = useTranslate();
  const { signedIn, signOut } = useSession();
  const [state, setState] = useState<'idle' | 'working' | 'failed'>('idle');
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">
        {translate('pl.tenants.shell.signedInAs', { name: signedIn.member.displayName })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={state === 'working'}
        onClick={() => {
          setState('working');
          void signOut().then((outcome) => {
            if (outcome === 'failed') {
              setState('failed');
            }
          });
        }}
      >
        <LogOutIcon aria-hidden />
        {translate(state === 'working' ? 'pl.tenants.shell.signingOut' : 'pl.tenants.shell.signOut')}
      </Button>
      {state === 'failed' ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {translate('pl.tenants.shell.signOutFailed')}
        </p>
      ) : null}
    </div>
  );
}
