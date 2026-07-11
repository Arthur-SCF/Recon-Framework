import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import type { Target } from "@/types/api";
import { InlineError } from "@/components/ui/InlineError";

const STATUS_DOT: Record<string, string> = {
  idle:         "text-muted-foreground",
  running:      "text-sev-info animate-pulse",
  completed:    "text-sev-low",
  paused:       "text-sev-medium",
  error:        "text-sev-critical",
  loop_stopped: "text-sev-high",
};

export function SidebarRecentTargets({ collapsed }: { collapsed: boolean }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const navigate = useNavigate();

  const doFetch = useCallback(() => {
    fetch("/api/v1/targets")
      .then((r) => (r.ok ? (r.json() as Promise<Target[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        const sorted = [...data]
          .sort((a, b) => {
            const aDate = a.last_scan_at ?? a.created_at;
            const bDate = b.last_scan_at ?? b.created_at;
            return bDate.localeCompare(aDate);
          })
          .slice(0, 5);
        setFetchError(null);
        setTargets(sorted);
      })
      .catch(() => { setFetchError("Failed to load"); setTargets([]); });
  }, []);

  useEffect(() => {
    doFetch();
    const interval = setInterval(doFetch, 30_000);
    return () => clearInterval(interval);
  }, [doFetch]);

  // Refresh immediately on any scan lifecycle event
  useWsSubscribe(
    ["scan_started", "scan_completed", "scan_error",
     "scan_paused", "scan_resumed", "scan_cancelled"],
    doFetch,
  );

  if (collapsed) return null;
  if (fetchError) {
    return (
      <div className="px-3 py-2">
        <InlineError message={fetchError} onRetry={doFetch} compact />
      </div>
    );
  }
  if (targets.length === 0) return null;

  return (
    <div className="px-3 py-2">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint-foreground mb-1.5">
        <span className="h-2 w-0.5 rounded-full bg-primary/60" aria-hidden="true" />
        Recent Targets
      </p>
      <div className="space-y-0.5">
        {targets.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/target/${t.id}`)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
          >
            <span
              className={cn(
                "led h-1.5 w-1.5 rounded-full shrink-0",
                STATUS_DOT[t.status] ?? STATUS_DOT.idle,
              )}
              style={{ backgroundColor: "currentColor" }}
            />
            <span className="font-mono truncate">{t.domain}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
