import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import type { Target } from "@/types/api";
import { InlineError } from "@/components/ui/InlineError";

const STATUS_DOT: Record<string, string> = {
  idle:         "bg-muted-foreground",
  running:      "bg-primary animate-pulse",
  completed:    "bg-green-400",
  paused:       "bg-yellow-400",
  error:        "bg-destructive",
  loop_stopped: "bg-amber-500",
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
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
        Recent Targets
      </p>
      <div className="space-y-0.5">
        {targets.map((t) => (
          <button
            key={t.id}
            onClick={() => navigate(`/target/${t.id}`)}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                STATUS_DOT[t.status] ?? STATUS_DOT.idle,
              )}
            />
            <span className="font-mono truncate">{t.domain}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
