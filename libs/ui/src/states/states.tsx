import type { MessageParams } from '@partledger/contracts';
import { CircleAlertIcon, InboxIcon, LockIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '../components/button';
import { Spinner } from '../components/display';
import { useTranslate } from '../i18n/translation';
import { cn } from '../lib/cn';

const stateClasses = 'flex flex-col items-center gap-3 px-6 py-10 text-center text-primary';
const iconClasses = 'size-8 text-muted';

export type HeadingLevel = 1 | 2 | 3;

const headingTags = { 1: 'h1', 2: 'h2', 3: 'h3' } as const;

interface StateLayoutProps {
  className?: string | undefined;
  /** Default 2; 1 when the state replaces the whole page, 3 inside a titled section. */
  headingLevel?: HeadingLevel | undefined;
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

export function EmptyState({ titleKey, descriptionKey, action, headingLevel = 2, className }: EmptyStateProps) {
  const translate = useTranslate();
  const Heading = headingTags[headingLevel];
  return (
    <div className={cn(stateClasses, className)}>
      <InboxIcon aria-hidden className={iconClasses} />
      <Heading className="text-base font-semibold">{translate(titleKey)}</Heading>
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
  /** Moves focus to the heading on mount, for an error state that replaces what had focus. */
  focusHeading?: boolean | undefined;
}

export function ErrorState({
  messageKey,
  messageParams,
  onRetry,
  headingLevel = 2,
  focusHeading = false,
  className,
}: ErrorStateProps) {
  const Heading = headingTags[headingLevel];
  const heading = useRef<HTMLHeadingElement>(null);
  const translate = useTranslate();
  const message = translateOrNull(() => translate(messageKey, messageParams));
  useEffect(() => {
    if (focusHeading) {
      heading.current?.focus();
    }
  }, [focusHeading]);
  return (
    <div role="alert" className={cn(stateClasses, className)}>
      <CircleAlertIcon aria-hidden className={cn(iconClasses, 'text-danger')} />
      <Heading ref={heading} tabIndex={-1} className="text-base font-semibold outline-hidden">
        {translate('pl.ui.state.error.title')}
      </Heading>
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

/** Staff screens use the default description; the supplier portal passes `pl.ui.state.noPermission.supplierDescription`. */
export function NoPermissionState({
  titleKey = 'pl.ui.state.noPermission.title',
  descriptionKey = 'pl.ui.state.noPermission.description',
  action,
  headingLevel = 2,
  className,
}: StateLayoutProps & { titleKey?: string; descriptionKey?: string; action?: ReactNode }) {
  const translate = useTranslate();
  const Heading = headingTags[headingLevel];
  return (
    <div className={cn(stateClasses, className)}>
      <LockIcon aria-hidden className={iconClasses} />
      <Heading className="text-base font-semibold">{translate(titleKey)}</Heading>
      <p className="max-w-prose text-sm text-muted">{translate(descriptionKey)}</p>
      {action === undefined ? null : <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
