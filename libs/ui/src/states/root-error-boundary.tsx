import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from './states';

interface RootErrorBoundaryProps {
  children: ReactNode;
  onError?: ((error: unknown, info: ErrorInfo) => void) | undefined;
  /** The unexpected-error message; the supplier portal passes its own, which points to the buyer. */
  messageKey?: string | undefined;
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

  private readonly content = createRef<HTMLDivElement>();

  private readonly retry = (): void => {
    this.setState({ failed: false });
  };

  // The retry button disappears with the error state, so focus moves to the page it rendered again.
  override componentDidUpdate(_props: RootErrorBoundaryProps, previous: RootErrorBoundaryState): void {
    if (previous.failed && !this.state.failed) {
      this.content.current?.focus();
    }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-surface">
          <ErrorState
            messageKey={this.props.messageKey ?? 'pl.ui.state.error.unexpected'}
            onRetry={this.retry}
            headingLevel={1}
            focusHeading
          />
        </main>
      );
    }
    return (
      <div ref={this.content} tabIndex={-1} className="outline-hidden">
        {this.props.children}
      </div>
    );
  }
}
