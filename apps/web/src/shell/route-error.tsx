import { ErrorState } from '@partledger/ui';
import type { ErrorComponentProps } from '@tanstack/react-router';

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
