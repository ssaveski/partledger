import { currentMemberQuery } from '@partledger/contracts';
import { failureMessageKey } from '@partledger/contracts/client';
import { Button, ErrorState, LoadingState, NoPermissionState, useTranslate } from '@partledger/ui';
import { LogInIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeyOf, useAdapterKind, useApiClient } from '../api/api-client';
import { redirectToSignIn, signInUrl } from '../auth/session';
import { useDocumentTitle } from './document-title';
import { sessionErrorTitle, sessionViewOf, type SignedIn } from './session-view';

export interface SessionContextValue {
  readonly signedIn: SignedIn;
  /** Ends the session; `failed` when the API could not be reached and the session may still stand. */
  readonly signOut: () => Promise<'signedOut' | 'failed'>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** The signed-in person; only screens inside `SessionProvider` render, so it is always there. */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === null) {
    throw new Error('useSession needs a SessionProvider');
  }
  return context;
}

/** The session read's key; a screen that changes the signed-in member reads it again. */
export const sessionQueryKey = ['session'] as const;

const unauthenticatedResult = z.object({
  ok: z.literal(false),
  failure: z.object({ kind: z.literal('unauthenticated') }),
});

/**
 * The staff app's session (KTD20): read through the typed client, the HTTP adapter against the
 * API's session endpoint or the fixtures in the preview, then the member's tenant and roles
 * through `tenants.currentMember`, which the API reads from the tenant's rows on every request.
 * Nothing renders until both have arrived.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const session = useQuery({ queryKey: sessionQueryKey, queryFn: () => client.session(), enabled: !signedOut });
  const member = useQuery({
    queryKey: queryKeyOf(currentMemberQuery, {}),
    queryFn: () => client.query(currentMemberQuery, {}),
    enabled: !signedOut && session.data?.ok === true,
  });
  const wasSignedIn = useRef(false);

  // Once signed in, any read the API refuses as unauthenticated means the session ended, such
  // as a member removed meanwhile: the app stops and says so rather than showing stale screens.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          wasSignedIn.current &&
          unauthenticatedResult.safeParse(event.query.state.data).success
        ) {
          queryClient.clear();
          setSignedOut(true);
        }
      }),
    [queryClient],
  );

  const view = sessionViewOf({
    session: session.data,
    member: member.data,
    signedOut,
    search: window.location.search,
  });

  const signOut = useCallback(async () => {
    const result = await client.signOut();
    if (!result.ok) {
      return 'failed' as const;
    }
    queryClient.clear();
    setSignedOut(true);
    return 'signedOut' as const;
  }, [client, queryClient]);

  useEffect(() => {
    if (view.kind === 'redirecting') {
      redirectToSignIn(window.location);
    }
  }, [view.kind]);

  const signedIn = view.kind === 'signedIn' ? view.signedIn : null;
  if (signedIn !== null) {
    wasSignedIn.current = true;
  }
  const context = useMemo(() => (signedIn === null ? null : { signedIn, signOut }), [signedIn, signOut]);

  switch (view.kind) {
    case 'checking':
      return (
        <SessionFrame
          titleKey="pl.tenants.session.checking"
          state={<LoadingState labelKey="pl.tenants.session.checking" />}
        />
      );
    case 'redirecting':
      return (
        <SessionFrame
          titleKey="pl.tenants.session.redirecting"
          state={<LoadingState labelKey="pl.tenants.session.redirecting" />}
        />
      );
    case 'signedOut':
      return (
        <SessionFrame
          titleKey="pl.tenants.session.signedOut.title"
          state={
            <SignInAgain
              titleKey="pl.tenants.session.signedOut.title"
              descriptionKey="pl.tenants.session.signedOut.description"
              focusHeading
            />
          }
        />
      );
    case 'signInFailed':
      return (
        <SessionFrame
          titleKey="pl.tenants.session.signInFailed.title"
          state={
            <SignInAgain
              titleKey="pl.tenants.session.signInFailed.title"
              descriptionKey="pl.tenants.session.signInFailed.description"
            />
          }
        />
      );
    case 'noRole':
      return <SessionFrame titleKey="pl.tenants.session.noRole.title" state={<NoRole onSignOut={signOut} />} />;
    case 'unavailable':
      return (
        <SessionFrame
          titleKey={sessionErrorTitle.key}
          state={
            <ErrorState
              headingLevel={1}
              messageKey={failureMessageKey(view.failure)}
              onRetry={() => {
                void (session.data?.ok === true ? member.refetch() : session.refetch());
              }}
            />
          }
        />
      );
    case 'signedIn':
      return <SessionContext value={context}>{children}</SessionContext>;
  }
}

/** A page of its own for each session state, with the main landmark every page has. */
function SessionFrame({ titleKey, state }: { titleKey: string; state: ReactNode }) {
  const translate = useTranslate();
  useDocumentTitle(titleKey, { screen: translate(sessionErrorTitle.screenKey) });
  return (
    <div className="flex min-h-screen flex-col bg-surface text-primary">
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-10">
        {state}
      </main>
    </div>
  );
}

function SignInAgain({
  titleKey,
  descriptionKey,
  focusHeading = false,
}: {
  titleKey: string;
  descriptionKey: string;
  /** After signing out the page the person was on is gone, so focus starts at this heading. */
  focusHeading?: boolean;
}) {
  const translate = useTranslate();
  const adapterKind = useAdapterKind();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading) {
      heading.current?.focus();
    }
  }, [focusHeading]);
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold outline-hidden">
        {translate(titleKey)}
      </h1>
      <p className="max-w-prose text-sm text-muted">{translate(descriptionKey)}</p>
      <Button
        className="mt-2"
        onClick={() => {
          // The preview has no identity provider: a fresh page is a fresh synthetic session.
          window.location.assign(adapterKind === 'http' ? signInUrl('/') : '/');
        }}
      >
        <LogInIcon aria-hidden />
        {translate('pl.tenants.session.signIn')}
      </Button>
    </div>
  );
}

function NoRole({ onSignOut }: { onSignOut: () => Promise<'signedOut' | 'failed'> }) {
  const translate = useTranslate();
  return (
    <NoPermissionState
      headingLevel={1}
      titleKey="pl.tenants.session.noRole.title"
      descriptionKey="pl.tenants.session.noRole.descriptionWithoutTenant"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            void onSignOut();
          }}
        >
          {translate('pl.tenants.shell.signOut')}
        </Button>
      }
    />
  );
}
