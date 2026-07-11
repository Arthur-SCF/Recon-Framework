import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  label?: string;
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

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? ` — ${this.props.label}` : ""}]`, error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/50 bg-card p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-sev-critical" />
          <div>
            <p className="text-sm font-medium text-foreground">Something went wrong</p>
            {this.props.label && (
              <p className="mt-0.5 text-xs text-muted-foreground">{this.props.label}</p>
            )}
            {this.state.error && (
              <p className="mt-1 font-mono text-xs text-sev-critical/80">
                {this.state.error.message}
              </p>
            )}
          </div>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" />
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
