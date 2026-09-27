import { EmptyState, ErrorState } from '@partledger/ui';
import type { ErrorComponentProps } from '@tanstack/react-router';

import { useDocumentTitle } from './document-title';

/**
 * The router catches rendering failures before the root error boundary can, so it shows the same
 * designed error state: in place of the whole shell when the shell itself failed, and inside the
 * shell's main region when a screen did.
 */
export function ShellError({ reset }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <ErrorState messageKey="pl.ui.state.error.unexpected" onRetry={reset} headingLevel={1} focusHeading />
    </main>
  );
}

export function ScreenError({ reset }: ErrorComponentProps) {
  return <ErrorState messageKey="pl.ui.state.error.unexpected" onRetry={reset} headingLevel={1} focusHeading />;
}

/** Suppliers arrive only through links, so an unknown address points back to the email, not to a menu. */
export function NotFoundPage() {
  useDocumentTitle('pl.portal.notFound.title');
  return (
    <EmptyState
      headingLevel={1}
      titleKey="pl.portal.notFound.title"
      descriptionKey="pl.portal.notFound.description"
      action={null}
    />
  );
}
