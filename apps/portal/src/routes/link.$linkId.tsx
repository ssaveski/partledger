import { linkIdSchema, linkSecretFromFragment, portalSessionQuery } from '@partledger/contracts/portal';
import { Button, ErrorState, Spinner, useTranslate } from '@partledger/ui';
import { useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { EyeOffIcon, KeyRoundIcon, ShieldCheckIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { queryKeyOf, useConnection } from '../api/connection';
import { useDocumentTitle } from '../shell/document-title';
import { LinkUnavailableState } from '../shell/link-unavailable';
import { viewPaths } from '../shell/session-layout';

const route = getRouteApi('/link/$linkId');

type LandingState = 'ready' | 'opening' | 'refused' | 'unavailable';

/** Removes the secret from the address bar and history, so it is not left behind once used. */
function stripFragment(): void {
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, '', `${pathname}${search}`);
}

/**
 * Where a supplier lands from an email. Loading this page sends nothing anywhere: the secret is in
 * the fragment, which browsers never send, and nothing is exchanged until the person presses
 * Continue. An email scanner that fetches or even renders the link therefore starts no session
 * and records no supplier action (AE7).
 */
export function LinkLanding() {
  const translate = useTranslate();
  const { linkId } = route.useParams();
  const connection = useConnection();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [secret] = useState(() => linkSecretFromFragment(window.location.hash));
  const [state, setState] = useState<LandingState>('ready');
  const unavailableLink = !linkIdSchema.safeParse(linkId).success || secret === null || state === 'refused';
  // The link-unavailable state names the tab itself; this only names the landing and its error.
  useDocumentTitle(
    state === 'unavailable' ? 'pl.portal.stateTitle.error' : 'pl.portal.landing.title',
    { screen: translate('pl.portal.landing.title') },
    !unavailableLink,
  );

  if (unavailableLink) {
    return <LinkUnavailableState />;
  }

  async function open(linkSecret: string): Promise<void> {
    stripFragment();
    setState('opening');
    const outcome = await connection.exchange(linkId, linkSecret);
    if (outcome !== 'opened') {
      setState(outcome);
      return;
    }
    // Reads cached under an earlier session must never show under this one.
    queryClient.clear();
    const session = await queryClient.query({
      queryKey: queryKeyOf(portalSessionQuery, {}),
      queryFn: () => connection.client.query(portalSessionQuery, {}),
    });
    if (!session.ok) {
      setState(session.failure.kind === 'unauthenticated' ? 'refused' : 'unavailable');
      return;
    }
    await navigate({ to: viewPaths[session.value.views[0]], replace: true });
  }

  if (state === 'unavailable') {
    return (
      <ErrorState
        headingLevel={1}
        focusHeading
        messageKey="pl.portal.landing.exchangeUnavailable"
        onRetry={() => {
          void open(secret);
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{translate('pl.portal.landing.title')}</h1>
        <p className="text-muted">{translate('pl.portal.landing.lead')}</p>
      </div>
      <ul className="flex flex-col gap-3">
        <Point icon={<ShieldCheckIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />}>
          {translate('pl.portal.landing.nothingRecorded')}
        </Point>
        <Point icon={<EyeOffIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />}>
          {translate('pl.portal.landing.ownLinesOnly')}
        </Point>
        <Point icon={<KeyRoundIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-info" />}>
          {translate('pl.portal.landing.keepPrivate')}
        </Point>
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={state === 'opening'}
          focusableWhenDisabled
          onClick={() => {
            void open(secret);
          }}
        >
          {state === 'opening' ? <Spinner /> : null}
          {translate('pl.portal.landing.continue')}
        </Button>
        <p role="status" className="text-sm text-muted">
          {state === 'opening' ? translate('pl.portal.landing.opening') : null}
        </p>
      </div>
    </div>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      {icon}
      <span>{children}</span>
    </li>
  );
}
