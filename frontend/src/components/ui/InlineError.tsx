import { AlertTriangle, RotateCw } from "lucide-react";

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function InlineError({ message, onRetry, compact = false }: InlineErrorProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 text-xs text-sev-critical/80">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="truncate">Failed to load</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-0.5 rounded p-0.5 hover:text-sev-critical transition-colors shrink-0"
            title="Retry"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-sev-critical/30 bg-sev-critical/10 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-sev-critical" />
      <p className="flex-1 min-w-0 text-sm text-sev-critical">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-sev-critical/30 px-2.5 py-1 text-xs text-sev-critical hover:bg-sev-critical/10 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
