import { Loader2, Repeat } from "lucide-react";
import { useSchedulerState, type NextScheduled } from "@/hooks/useSchedulerState";
import { cn } from "@/lib/utils";

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function pad2(n: number) { return String(n).padStart(2, "0"); }
function fmtSched(s: NextScheduled): string {
  if (s.schedule_mode === "daily") {
    return `every ${s.schedule_days}d @ ${pad2(s.schedule_hour)}:${pad2(s.schedule_minute)}`;
  }
  if (s.schedule_mode === "weekly") {
    return `${WEEKDAYS_SHORT[s.schedule_weekday]} @ ${pad2(s.schedule_hour)}:${pad2(s.schedule_minute)}`;
  }
  const h = s.rescan_interval;
  return h < 24 ? `every ${h}h` : `every ${h / 24}d`;
}

export function SidebarScanStatus({ collapsed }: { collapsed: boolean }) {
  const { state } = useSchedulerState();

  const active    = state?.active ?? null;
  const nextUp    = state?.queue?.[0] ?? null;
  const nextAuto  = state?.scheduled?.[0] ?? null;
  const nextLoop  = state?.next_loop ?? null;

  if (!active) {
    if (collapsed) return null;
    return (
      <div className="px-3 py-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint-foreground mb-1.5">
          <span className="h-2 w-0.5 rounded-full bg-primary/60" aria-hidden="true" />
          Scan Status
        </p>
        <p className="text-xs text-muted-foreground">No active scan</p>
        {nextUp && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="text-primary/70">Next:</span>
            {nextUp.loop && <Repeat className="h-2.5 w-2.5 text-primary/60 shrink-0" />}
            <span className="font-mono truncate">{nextUp.domain}</span>
          </div>
        )}
        {nextAuto && (
          <div className="mt-1.5 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground/60 shrink-0">Sched:</span>
              <span className="font-mono truncate flex-1">{nextAuto.domain}</span>
              <span className={cn(
                "shrink-0 font-mono tabular-nums",
                nextAuto.is_due ? "text-sev-medium" : "text-faint-foreground"
              )}>
                {fmtCountdown(nextAuto.next_run_at)}
              </span>
            </div>
            <p className="pl-9 font-mono tabular-nums text-faint-foreground">{fmtSched(nextAuto)}</p>
          </div>
        )}
        {nextLoop && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="text-muted-foreground/60">Loop:</span>
            <Repeat className="h-2.5 w-2.5 text-primary/60 shrink-0" />
            <span className="font-mono truncate">{nextLoop.domain}</span>
          </div>
        )}
      </div>
    );
  }

  const progress = active.steps_total > 0
    ? Math.round((active.steps_done / active.steps_total) * 100)
    : 0;

  const elapsedStr = active.started_at ? formatElapsed(new Date(active.started_at)) : "";

  if (collapsed) {
    return (
      <div className="flex justify-center px-1 py-2" aria-label={`Scanning ${active.domain}`}>
        <Loader2 className="h-4 w-4 animate-spin text-sev-info" />
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint-foreground mb-1.5">
        <span className="h-2 w-0.5 rounded-full bg-primary/60" aria-hidden="true" />
        Active Scan
      </p>
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="led h-1.5 w-1.5 rounded-full bg-sev-info text-sev-info animate-pulse shrink-0"
          style={{ backgroundColor: "currentColor" }}
        />
        <span className="text-xs font-mono font-medium text-foreground truncate">
          {active.domain}
        </span>
        {active.loop && (
          <Repeat className="h-3 w-3 text-primary/70 shrink-0" aria-label="Loop mode" />
        )}
      </div>
      {active.current_step && (
        <p className="text-[10px] text-muted-foreground truncate mb-1">
          {active.current_step}
        </p>
      )}
      {/* Progress bar */}
      <div className="h-1 w-full rounded-full bg-muted overflow-hidden mb-1">
        <div
          className="h-full rounded-full bg-sev-info transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
        <span>{progress}%</span>
        {elapsedStr && <span>{elapsedStr}</span>}
      </div>

      {/* Next up */}
      {nextUp && (
        <div className="mt-2 pt-2 border-t border-border flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="text-primary/70 shrink-0">Next:</span>
          {nextUp.loop && <Repeat className="h-2.5 w-2.5 text-primary/60 shrink-0" />}
          <span className="font-mono truncate">{nextUp.domain}</span>
        </div>
      )}
      {/* Next loop (only when queue is empty) */}
      {nextLoop && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground/60 shrink-0">Loop:</span>
          <Repeat className="h-2.5 w-2.5 text-primary/60 shrink-0" />
          <span className="font-mono truncate">{nextLoop.domain}</span>
        </div>
      )}
    </div>
  );
}

function fmtCountdown(isoStr: string): string {
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return "overdue";
  const secs = Math.floor(diff / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatElapsed(start: Date): string {
  const diff = Math.floor((Date.now() - start.getTime()) / 1000);
  if (isNaN(diff) || diff < 0) return "";
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}
