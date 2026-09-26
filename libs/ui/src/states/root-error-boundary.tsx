import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from './states';

interface RootErrorBoundaryProps {
  children: ReactNode;
  onError?: ((error: unknown, info: ErrorInfo) => void) | undefined;
}

interface RootErrorBoundaryState {
  failed: boolean;
}

/** Shows the designed error state instead of a blank page when rendering throws, a missing translation key included. */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  override state: RootErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-surface">
          <ErrorState messageKey="pl.ui.state.error.unexpected" onRetry={this.retry} headingLevel={1} />
        </main>
      );
    }
    return this.props.children;
  }
}
