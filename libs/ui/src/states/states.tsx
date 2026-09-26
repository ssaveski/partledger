import type { MessageParams } from '@partledger/contracts';
import { CircleAlertIcon, InboxIcon, LockIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '../components/button';
import { Spinner } from '../components/display';
import { useTranslate } from '../i18n/translation';
import { cn } from '../lib/cn';

const stateClasses = 'flex flex-col items-center gap-3 px-6 py-10 text-center text-primary';
const iconClasses = 'size-8 text-muted';

interface StateLayoutProps {
  className?: string | undefined;
}

export function LoadingState({
  labelKey = 'pl.ui.state.loading.label',
  className,
}: StateLayoutProps & { labelKey?: string }) {
  const translate = useTranslate();
  return (
    <div role="status" aria-live="polite" className={cn(stateClasses, className)}>
      <Spinner className={cn(iconClasses, 'text-accent')} />
      <p className="text-sm text-muted">{translate(labelKey)}</p>
    </div>
  );
}

export interface EmptyStateProps extends StateLayoutProps {
  titleKey: string;
  descriptionKey: string;
  /** The next thing the person can do, such as an import or create button. */
  action: ReactNode;
}

export function EmptyState({ titleKey, descriptionKey, action, className }: EmptyStateProps) {
  const translate = useTranslate();
  return (
    <div className={cn(stateClasses, className)}>
      <InboxIcon aria-hidden className={iconClasses} />
      <h2 className="text-base font-semibold">{translate(titleKey)}</h2>
      <p className="max-w-prose text-sm text-muted">{translate(descriptionKey)}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>
    </div>
  );
}

export interface ErrorStateProps extends StateLayoutProps {
  /** Message key from the failed response; an unknown key or missing param shows the generic message instead of failing again. */
  messageKey: string;
  messageParams?: MessageParams | undefined;
  onRetry: () => void;
  /** 1 when the error state replaces the whole page. */
  headingLevel?: 1 | 2;
}

export function ErrorState({ messageKey, messageParams, onRetry, headingLevel = 2, className }: ErrorStateProps) {
  const Heading = headingLevel === 1 ? 'h1' : 'h2';
  const translate = useTranslate();
  const message = translateOrNull(() => translate(messageKey, messageParams));
  return (
    <div role="alert" className={cn(stateClasses, className)}>
      <CircleAlertIcon aria-hidden className={cn(iconClasses, 'text-danger')} />
      <Heading className="text-base font-semibold">{translate('pl.ui.state.error.title')}</Heading>
      <p className="max-w-prose text-sm text-muted">{message ?? translate('pl.ui.state.error.unexpected')}</p>
      <Button variant="secondary" className="mt-2" onClick={onRetry}>
        {translate('pl.ui.state.error.retry')}
      </Button>
    </div>
  );
}

function translateOrNull(format: () => string): string | null {
  try {
    return format();
  } catch {
    return null;
  }
}

export function NoPermissionState({
  titleKey = 'pl.ui.state.noPermission.title',
  descriptionKey = 'pl.ui.state.noPermission.description',
  action,
  className,
}: StateLayoutProps & { titleKey?: string; descriptionKey?: string; action?: ReactNode }) {
  const translate = useTranslate();
  return (
    <div className={cn(stateClasses, className)}>
      <LockIcon aria-hidden className={iconClasses} />
      <h2 className="text-base font-semibold">{translate(titleKey)}</h2>
      <p className="max-w-prose text-sm text-muted">{translate(descriptionKey)}</p>
      {action === undefined ? null : <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
