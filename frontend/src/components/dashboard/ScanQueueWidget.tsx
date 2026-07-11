import { useState } from "react";
import { Activity, Clock, Calendar, Repeat, PauseCircle, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSchedulerState, type NextScheduled } from "@/hooks/useSchedulerState";
import { useActionFetch } from "@/hooks/useActionFetch";

const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function pad2(n: number) { return String(n).padStart(2, "0"); }

function formatScheduleDetail(s: NextScheduled): string {
  if (s.schedule_mode === "daily") {
    const time = `${pad2(s.schedule_hour)}:${pad2(s.schedule_minute)}`;
    return `every ${s.schedule_days} ${s.schedule_days === 1 ? "day" : "days"} at ${time}`;
  }
  if (s.schedule_mode === "weekly") {
    const time = `${pad2(s.schedule_hour)}:${pad2(s.schedule_minute)}`;
    return `every ${WEEKDAYS_SHORT[s.schedule_weekday]} at ${time}`;
  }
  const h = s.rescan_interval;
  if (h < 24) return `every ${h}h`;
  const d = h / 24;
  return `every ${Number.isInteger(d) ? `${d} day${d !== 1 ? "s" : ""}` : `${h}h`}`;
}

function formatCountdown(isoStr: string): string {
  const diff = new Date(isoStr).getTime() - Date.now();
  if (diff <= 0) return "overdue";
  const totalSecs = Math.floor(diff / 1000);
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

function elapsed(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff) || diff < 0) return "—";
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export function ScanQueueWidget() {
  const { state, refresh } = useSchedulerState();
  const [toggling, setToggling] = useState(false);
  const { actionFetch } = useActionFetch();

  const active      = state?.active ?? null;
  const manualQueue = state?.queue ?? [];
  const nextUp      = manualQueue[0] ?? null;
  const waiting     = manualQueue.slice(1);
  const scheduled   = state?.scheduled ?? [];
  const nextLoop    = state?.next_loop ?? null;
  const loopsPaused = state?.loops_paused ?? false;
  const queuePaused = state?.queue_paused ?? false;

  const hasAnyLoop =
    active?.loop ||
    manualQueue.some((q) => q.loop) ||
    !!state?.next_loop;
  const hasAnyScheduled = scheduled.length > 0;

  const hasAnyQueued = manualQueue.length > 0;

  async function toggleLoops() {
    if (toggling) return;
    setToggling(true);
    try {
      const path = loopsPaused ? "resume" : "pause";
      const label = loopsPaused ? "resume loops" : "pause loops";
      await actionFetch(`/api/v1/scheduler/loops/${path}`, {
        method: "POST",
        errorPrefix: `Failed to ${label}`,
      });
      await refresh();
    } finally {
      setToggling(false);
    }
  }

  async function toggleQueue() {
    if (toggling) return;
    setToggling(true);
    try {
      const path = queuePaused ? "resume" : "pause";
      const label = queuePaused ? "resume queue" : "pause queue";
      await actionFetch(`/api/v1/scheduler/queue/${path}`, {
        method: "POST",
        errorPrefix: `Failed to ${label}`,
      });
      await refresh();
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 min-w-0 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground shrink-0">
          <Activity className="h-3.5 w-3.5 text-faint-foreground" />
          Scan Queue
        </div>

        {/* Pause/resume buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Pause manual queue — shown when items are queued or queue is paused */}
          {(hasAnyQueued || queuePaused) && (
            <button
              onClick={() => void toggleQueue()}
              disabled={toggling}
              className={cn(
                "flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded border transition-colors disabled:opacity-50",
                queuePaused
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
              title={queuePaused ? "Resume all scans (queue + loops)" : "Pause everything — queue and loops"}
            >
              {queuePaused ? (
                <><PlayCircle className="h-3 w-3" /> <span className="hidden sm:inline">Resume queue</span><span className="sm:hidden">Resume</span></>
              ) : (
                <><PauseCircle className="h-3 w-3" /> <span className="hidden sm:inline">Pause queue</span><span className="sm:hidden">Pause</span></>
              )}
            </button>
          )}

          {/* Stop / resume loops — hidden when queue is already paused (redundant) */}
          {!queuePaused && (hasAnyLoop || loopsPaused) && (
            <button
              onClick={() => void toggleLoops()}
              disabled={toggling}
              className={cn(
                "flex items-center gap-1 font-mono text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded border transition-colors disabled:opacity-50",
                loopsPaused
                  ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:border-primary/40",
              )}
              title={loopsPaused ? "Resume all loops" : "Stop all loops (current scan finishes normally)"}
            >
              {loopsPaused ? (
                <><PlayCircle className="h-3 w-3" /> <span className="hidden sm:inline">Resume loops</span><span className="sm:hidden">Loops</span></>
              ) : (
                <><PauseCircle className="h-3 w-3" /> <span className="hidden sm:inline">Stop loops</span><span className="sm:hidden">Loops</span></>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Queue paused banner — covers both queue and loops */}
      {queuePaused && (
        <div className="mb-3 flex items-center gap-1.5 rounded border border-sev-info/30 bg-sev-info/10 px-2 py-1.5 text-[11px] text-sev-info">
          <PauseCircle className="h-3 w-3 shrink-0" />
          All scans paused — queue and loops stopped
        </div>
      )}

      {/* Loops paused banner — only when queue is NOT paused */}
      {loopsPaused && !queuePaused && (
        <div className="mb-3 flex items-center gap-1.5 rounded border border-sev-medium/30 bg-sev-medium/10 px-2 py-1.5 text-[11px] text-sev-medium">
          <PauseCircle className="h-3 w-3 shrink-0" />
          Loops paused — scheduled scans still run
        </div>
      )}

      {/* Active scan */}
      {active ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className="led h-2 w-2 rounded-full bg-sev-info text-sev-info animate-pulse shrink-0"
              style={{ backgroundColor: "currentColor" }}
            />
            <span className="text-sm font-mono text-foreground truncate">{active.domain ?? "—"}</span>
            {active.loop && <Repeat className="h-3 w-3 text-primary/70 shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            {elapsed(active.started_at)}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No active scan</p>
      )}

      {/* Next up (position 1) */}
      {nextUp && (
        <div className="mt-3 border-t border-border pt-2 space-y-1">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground mb-1.5">
            Next up
          </p>
          <div className="flex items-center gap-2">
            <span
              className="led h-2 w-2 rounded-full bg-primary/60 text-primary/60 shrink-0"
              style={{ backgroundColor: "currentColor" }}
            />
            <span className="text-xs font-mono text-foreground truncate">{nextUp.domain}</span>
            {nextUp.loop && <Repeat className="h-3 w-3 text-primary/60 shrink-0" />}
          </div>
        </div>
      )}

      {/* Rest of manual queue */}
      {waiting.length > 0 && (
        <div className={cn("space-y-1", nextUp ? "mt-2" : "mt-3 border-t border-border pt-2")}>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground mb-1.5">
            Queued ({waiting.length})
          </p>
          {waiting.map((q, i) => (
            <div key={q.target_id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono text-[10px] tabular-nums w-3 text-right text-faint-foreground shrink-0">{i + 2}</span>
              <span
                className="led h-1.5 w-1.5 rounded-full bg-muted-foreground/40 text-muted-foreground/40 shrink-0"
                style={{ backgroundColor: "currentColor" }}
              />
              <span className="font-mono truncate">{q.domain}</span>
              {q.loop && <Repeat className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0" />}
            </div>
          ))}
        </div>
      )}

      {/* Scheduled targets — always shown, sorted by next_run_at */}
      {hasAnyScheduled && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground mb-1.5">
            Scheduled
          </p>
          <div className="space-y-2">
            {scheduled.map((s) => (
              <div key={s.target_id}>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span className="font-mono truncate flex-1">{s.domain}</span>
                  <span className={cn(
                    "font-mono text-[10px] shrink-0 tabular-nums",
                    s.is_due ? "text-sev-medium" : "text-faint-foreground"
                  )}>
                    {formatCountdown(s.next_run_at)}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] tabular-nums text-faint-foreground pl-5">
                  {formatScheduleDetail(s)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next loop target — always shown unless loops paused or loop_stopped */}
      {nextLoop && (
        <div className="mt-3 border-t border-border pt-2">
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground mb-1.5">
            Loop next
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Repeat className="h-3 w-3 shrink-0 text-primary/50" />
            <span className="font-mono truncate">{nextLoop.domain}</span>
            <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-faint-foreground shrink-0">auto</span>
          </div>
        </div>
      )}

      {/* Idle */}
      {!active && !nextUp && !hasAnyScheduled && !nextLoop && (
        <p className="text-[11px] text-faint-foreground mt-2">Nothing queued</p>
      )}
    </div>
  );
}
