import { staffAlertsQuery, type StaffAlert } from '@partledger/contracts';
import { failureMessageKey, isPermissionFailure, type ClientResult } from '@partledger/contracts/client';
import {
  Badge,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
  cn,
  focusRing,
  useTranslate,
  type Translate,
} from '@partledger/ui';
import { BellIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useApiQuery } from '../api/api-client';
import { formatInstantUtc } from './format';

/**
 * The staff shell's alerts (U34): a banner button that opens the tenant's recent operational
 * alerts and the reader's in-app notifications. The read is declared in the contracts
 * (`notifications.alerts`), so the fixture adapter and the API serve the same shape.
 */
export function AlertsMenu() {
  const translate = useTranslate();
  const query = useApiQuery(staffAlertsQuery, {});
  const result = query.data;
  const count = result?.ok === true ? result.value.alerts.length : null;
  return (
    <Dialog>
      <DialogTrigger
        className="h-8 gap-2"
        aria-label={
          count === null || count === 0
            ? translate('pl.notifications.shell.open')
            : translate('pl.notifications.shell.openWithCount', { count })
        }
      >
        <BellIcon aria-hidden className="size-4" />
        {translate('pl.notifications.shell.open')}
        {count === null || count === 0 ? null : (
          <Badge tone="accent" aria-hidden>
            {count}
          </Badge>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[min(40rem,calc(100vh-4rem))] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogTitle>{translate('pl.notifications.shell.title')}</DialogTitle>
        <DialogDescription>{translate('pl.notifications.shell.description')}</DialogDescription>
        <AlertsPanel
          result={result}
          loading={result === undefined || (query.isFetching && !result.ok)}
          onRetry={() => {
            void query.refetch();
          }}
          closeAction={<DialogClose>{translate('pl.notifications.shell.close')}</DialogClose>}
        />
      </DialogContent>
    </Dialog>
  );
}

/** The panel's designed states: loading, no permission, error with retry, empty, and the list. */
export function AlertsPanel({
  result,
  loading,
  onRetry,
  closeAction,
}: {
  result: ClientResult<{ readonly alerts: readonly StaffAlert[] }> | undefined;
  loading: boolean;
  onRetry: () => void;
  /** Closes the dialog; the empty state offers it as its next step. */
  closeAction: ReactNode;
}) {
  const translate = useTranslate();
  if (loading || result === undefined) {
    return <LoadingState labelKey="pl.notifications.shell.loading" />;
  }
  if (!result.ok) {
    return isPermissionFailure(result.failure) ? (
      <NoPermissionState headingLevel={3} />
    ) : (
      <ErrorState headingLevel={3} messageKey={failureMessageKey(result.failure)} onRetry={onRetry} />
    );
  }
  if (result.value.alerts.length === 0) {
    return (
      <EmptyState
        headingLevel={3}
        titleKey="pl.notifications.shell.empty.title"
        descriptionKey="pl.notifications.shell.empty.description"
        action={closeAction}
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-line">
      {result.value.alerts.map((alert) => (
        <AlertItem key={alert.alertId} alert={alert} translate={translate} />
      ))}
    </ul>
  );
}

/** An alert whose text this build cannot show falls back to the generic wording rather than failing the shell. */
function translateOr(translate: Translate, key: string, params: StaffAlert['params'], fallbackKey: string): string {
  try {
    return translate(key, params);
  } catch {
    return translate(fallbackKey);
  }
}

function AlertItem({ alert, translate }: { alert: StaffAlert; translate: Translate }) {
  const title = translateOr(translate, alert.titleKey, alert.params, 'pl.notifications.shell.title');
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge tone={alert.source === 'operational' ? 'warning' : 'neutral'}>
          {translate(`pl.notifications.shell.source.${alert.source}`)}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        {translateOr(translate, alert.descriptionKey, alert.params, 'pl.ui.state.error.unexpected')}
      </p>
      <p className="text-xs text-muted">
        {translate('pl.notifications.shell.raisedAt', {
          instant: translate('pl.web.format.utc', { instant: formatInstantUtc(alert.raisedAt) }),
        })}
      </p>
      {alert.path === null ? null : (
        <a
          href={alert.path}
          className={cn('self-start rounded-md text-sm font-medium text-accent underline', focusRing)}
        >
          {translate('pl.notifications.shell.view')}
          <span className="sr-only">{translate('pl.notifications.shell.viewContext', { title })}</span>
        </a>
      )}
    </li>
  );
}
