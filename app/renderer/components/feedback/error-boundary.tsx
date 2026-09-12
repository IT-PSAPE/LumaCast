import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex items-center justify-center h-full p-8 text-center">
        <div className="flex flex-col gap-4 max-w-md">
          <h2 className="text-lg font-semibold text-primary">Something went wrong</h2>
          <p className="text-sm text-secondary">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="justify-self-center rounded border border-brand bg-brand/15 px-4 py-2 text-sm text-primary transition-colors hover:bg-brand/20"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
