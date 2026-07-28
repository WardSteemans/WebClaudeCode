import { Component, type ReactNode } from 'react';
import { createFrontendLogger } from '../logger';

const log = createFrontendLogger('ErrorBoundary');

interface Props {
  children: ReactNode;
  /** Optional label shown in the error message */
  name?: string;
  /** Custom fallback, receives error + reset callback */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  key: number; // bump to force remount on reset
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, key: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    log.error(`Caught render error${this.props.name ? ` in ${this.props.name}` : ''}`, error, {
      componentStack: info.componentStack?.slice(0, 2000),
      componentName: this.props.name,
    });
    console.error(
      `[ErrorBoundary${this.props.name ? `: ${this.props.name}` : ''}]`,
      error,
      '\nComponent stack:\n',
      info.componentStack
    );
  }

  handleReset = () => {
    this.setState((s) => ({ error: null, key: s.key + 1 }));
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset);
      }

      return (
        <div className="flex items-center justify-center h-full p-6">
          <div className="text-center max-w-sm">
            <div className="text-[32px] mb-2">⚠️</div>
            <h3 className="text-[13px] font-semibold text-[var(--color-text)] mb-1">
              {this.props.name ? `${this.props.name} crashed` : 'Something went wrong'}
            </h3>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-3 break-all">
              {this.state.error.message || 'Unknown error'}
            </p>
            <button
              onClick={this.handleReset}
              className="text-[12px] px-3 py-1.5 bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors border border-[var(--color-border)]"
            >
              Reload panel
            </button>
          </div>
        </div>
      );
    }

    return <ErrorBoundaryInner key={this.state.key}>{this.props.children}</ErrorBoundaryInner>;
  }
}

/** Inner component so key-bumping forces a clean remount of children */
function ErrorBoundaryInner({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
