import { Loader2, Play, Pause, Square, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanSession } from "@/types/api";

const PAUSE_LABELS: Record<string, string> = {
  manual:        "manual",
  auto:          "preempted",
  auto_recovery: "crash recovery",
  wildcard:      "wildcard detected",
  shutdown:      "shutdown",
  queued_resume: "waiting to resume",
  step_failure:  "step failed — action required",
};

interface PipelineControlsProps {
  session: ScanSession | null;
  isRunning: boolean;
  isPaused: boolean;
  pending: boolean;
  isQueued: boolean;
  queuePosition: number | undefined;
  onAction: (action: "start" | "pause" | "resume" | "cancel") => void;
  onDequeue: () => void;
}

export function PipelineControls({
  session,
  isRunning,
  isPaused,
  pending,
  isQueued,
  queuePosition,
  onAction,
  onDequeue,
}: PipelineControlsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Idle: show Start Scan OR queued state */}
      {!isRunning && !isPaused && (
        isQueued ? (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
              <Clock className="h-3 w-3 animate-pulse" />
              {queuePosition === 1 ? "Next up" : `Queued #${queuePosition}`}
            </div>
            <button
              onClick={onDequeue}
              title="Remove from queue"
              className="flex items-center gap-1 rounded-md border border-white/[0.08] px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
            >
              <X className="h-3 w-3" />
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={() => onAction("start")}
            disabled={pending}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              pending
                ? "bg-primary/40 text-primary-foreground/60 cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {pending ? (
              <><Loader2 className="h-3 w-3 animate-spin" /> Queuing…</>
            ) : (
              <><Play className="h-3 w-3" /> Start Scan</>
            )}
          </button>
        )
      )}

      {/* Running */}
      {isRunning && (
        <button
          onClick={() => onAction("pause")}
          className="flex items-center gap-1.5 rounded-md bg-yellow-500/20 border border-yellow-500/40 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/30 transition-colors"
        >
          <Pause className="h-3 w-3" /> Pause
        </button>
      )}

      {/* Paused */}
      {isPaused && (
        <button
          onClick={() => onAction("resume")}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Play className="h-3 w-3" /> Resume
        </button>
      )}

      {/* Cancel (running or paused) */}
      {(isRunning || isPaused) && (
        <button
          onClick={() => onAction("cancel")}
          className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
        >
          <Square className="h-3 w-3" /> Cancel
        </button>
      )}

      {session && (
        <span className="ml-2 text-xs text-muted-foreground capitalize">
          {session.status}
          {session.pause_type ? ` (${PAUSE_LABELS[session.pause_type] ?? session.pause_type})` : ""}
        </span>
      )}
    </div>
  );
}
