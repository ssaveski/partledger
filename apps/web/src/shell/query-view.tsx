import { failureMessageKey, isPermissionFailure, type ClientResult } from '@partledger/contracts/client';
import { ErrorState, LoadingState, NoPermissionState, useTranslate } from '@partledger/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useDocumentTitle } from './document-title';

/**
 * The designed states every screen shares: loading while the read is in flight, no permission
 * when the server refuses the principal, and an error with retry for anything else. Each
 * replaces the page, so it carries the page's level-one heading.
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
  const result = query.data;
  const loading = result === undefined || (query.isFetching && !result.ok);
  const denied = !loading && !result.ok && isPermissionFailure(result.failure);
  const failed = !loading && !result.ok && !denied;
  // While a state replaces the screen it names the tab; once the read arrives the screen does.
  useDocumentTitle(
    denied ? 'pl.web.stateTitle.noPermission' : failed ? 'pl.web.stateTitle.error' : titleKey,
    { screen: translate(titleKey) },
    loading || denied || failed,
  );
  if (loading) {
    return (
      <>
        <h1 className="sr-only">{translate(titleKey)}</h1>
        <LoadingState labelKey={loadingKey} />
      </>
    );
  }
  if (!result.ok) {
    if (isPermissionFailure(result.failure)) {
      return <NoPermissionState headingLevel={1} />;
    }
    return (
      <ErrorState
        headingLevel={1}
        messageKey={failureMessageKey(result.failure)}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  return children(result.value);
}
