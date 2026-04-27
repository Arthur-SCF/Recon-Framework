import { AlertCircle, RotateCw } from "lucide-react";

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export function InlineError({ message, onRetry, compact = false }: InlineErrorProps) {
  if (compact) {
    return (
      <div className="flex items-center gap-1 text-xs text-destructive/80">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="truncate">Failed to load</span>
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-0.5 rounded p-0.5 hover:text-destructive transition-colors shrink-0"
            title="Retry"
          >
            <RotateCw className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
      <p className="flex-1 min-w-0 text-sm text-destructive">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-md border border-destructive/30 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  );
}
