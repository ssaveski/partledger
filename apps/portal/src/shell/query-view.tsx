import { failureMessageKey, isPermissionFailure, type ClientResult } from '@partledger/contracts/client';
import { ErrorState, LoadingState, NoPermissionState, useTranslate } from '@partledger/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useDocumentTitle } from './document-title';
import { LinkUnavailableState } from './link-unavailable';

type ViewState = 'loading' | 'linkUnavailable' | 'noPermission' | 'error' | 'ready';

function viewState<Value>(query: UseQueryResult<ClientResult<Value>>): ViewState {
  const result = query.data;
  if (result === undefined || (query.isFetching && !result.ok)) {
    return 'loading';
  }
  if (result.ok) {
    return 'ready';
  }
  if (result.failure.kind === 'unauthenticated') {
    return 'linkUnavailable';
  }
  return isPermissionFailure(result.failure) ? 'noPermission' : 'error';
}

/**
 * The designed states every portal screen shares: loading while the read is in flight, "link no
 * longer available" when the session or link is refused, no permission when the link does not
 * open this screen, and an error with retry for anything else. Each replaces the page, so it
 * carries the page's level-one heading.
 */
export function QueryView<Value>({
  query,
  titleKey,
  loadingKey,
  children,
}: {
  query: UseQueryResult<ClientResult<Value>>;
  /** The screen's name, the page heading while the read is in flight. */
  titleKey: string;
  loadingKey: string;
  children: (value: Value) => ReactNode;
}) {
  const translate = useTranslate();
  const state = viewState(query);
  useDocumentTitle(
    state === 'noPermission'
      ? 'pl.portal.stateTitle.noPermission'
      : state === 'error'
        ? 'pl.portal.stateTitle.error'
        : titleKey,
    { screen: translate(titleKey) },
    state === 'loading' || state === 'noPermission' || state === 'error',
  );
  const result = query.data;
  switch (state) {
    case 'loading':
      return (
        <>
          <h1 className="sr-only">{translate(titleKey)}</h1>
          <LoadingState labelKey={loadingKey} />
        </>
      );
    case 'linkUnavailable':
      return <LinkUnavailableState />;
    case 'noPermission':
      return <NoPermissionState headingLevel={1} descriptionKey="pl.ui.state.noPermission.supplierDescription" />;
    case 'error':
      return (
        <ErrorState
          headingLevel={1}
          messageKey={
            result === undefined || result.ok ? 'pl.ui.state.error.unexpected' : failureMessageKey(result.failure)
          }
          onRetry={() => {
            void query.refetch();
          }}
        />
      );
    case 'ready':
      return result?.ok === true ? children(result.value) : null;
  }
}
