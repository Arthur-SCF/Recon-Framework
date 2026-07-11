import { useState } from "react";
import { motion } from "framer-motion";
import { Trash2, Repeat, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { Target } from "@/types/api";

const STATUS_CONFIG: Record<string, { label: string; tone: string; rule: string }> = {
  idle:         { label: "Idle",         tone: "text-muted-foreground", rule: "bg-muted-foreground/40" },
  running:      { label: "Running",      tone: "text-sev-info",         rule: "bg-sev-info" },
  completed:    { label: "Done",         tone: "text-sev-low",          rule: "bg-sev-low" },
  paused:       { label: "Paused",       tone: "text-sev-medium",       rule: "bg-sev-medium" },
  error:        { label: "Error",        tone: "text-sev-critical",     rule: "bg-sev-critical" },
  loop_stopped: { label: "Loop stopped", tone: "text-sev-high",         rule: "bg-sev-high" },
};

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface TargetCardProps {
  target: Target;
  index: number;
  onClick: () => void;
  onDelete?: () => Promise<void>;
  onRestart?: () => Promise<void>;
  /** 1-based position in the manual queue (undefined = not queued) */
  queuePosition?: number;
}

export function TargetCard({
  target,
  index,
  onClick,
  onDelete,
  onRestart,
  queuePosition,
}: TargetCardProps) {
  const cfg = STATUS_CONFIG[target.status] ?? STATUS_CONFIG.idle;
  const [deleteOpen,   setDeleteOpen]   = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [restarting,   setRestarting]   = useState(false);

  const isLoopStopped = target.status === "loop_stopped";
  const isQueued      = queuePosition !== undefined;

  async function handleDelete() {
    if (!onDelete) return;
    setDeleting(true);
    try { await onDelete(); } finally { setDeleting(false); }
  }

  async function handleRestart(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onRestart || restarting) return;
    setRestarting(true);
    try { await onRestart(); } finally { setRestarting(false); }
  }

  return (
    <>
      <motion.div
        className={cn(
          "group relative overflow-hidden rounded-lg border border-border bg-card p-4 text-left cursor-pointer",
          "transition-[border-color,background-color] duration-200",
          "hover:border-primary/40 hover:bg-surface-hover",
          isQueued && "ring-1 ring-primary/20",
        )}
        onClick={onClick}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        whileHover={{ y: -2 }}
      >
        {/* Severity rule keyed to status */}
        <span className={cn("absolute inset-y-0 left-0 w-0.5", cfg.rule)} aria-hidden="true" />

        {/* Delete button — top-right, visible on hover */}
        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); setDeleteOpen(true); }}
            className="absolute right-2 top-2 rounded p-1 text-muted-foreground/0 group-hover:text-muted-foreground/40 hover:!text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Delete target"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Queue position badge — top-left corner */}
        {isQueued && (
          <span className={cn(
            "absolute left-2 top-2 z-[1] rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide tabular-nums",
            queuePosition === 1
              ? "bg-primary/15 text-primary"
              : "bg-muted/70 text-muted-foreground",
          )}>
            {queuePosition === 1 ? "Next up" : `#${queuePosition}`}
          </span>
        )}

        {/* Domain + status */}
        <div className={cn("flex items-start justify-between gap-2", isQueued && "mt-4")}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-[13px] font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
              {target.domain}
            </p>
            <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
              {target.scan_count} scan{target.scan_count !== 1 ? "s" : ""} ·{" "}
              {relativeTime(target.last_scan_at)}
            </p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-wide", cfg.tone)}>
            <span
              className={cn("led h-1.5 w-1.5 rounded-full", target.status === "running" && "animate-pulse")}
              style={{ backgroundColor: "currentColor" }}
            />
            {cfg.label}
          </span>
        </div>

        {/* Metadata badges */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            P{target.scan_priority}
          </span>
          <span className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {target.wildcard_policy}
          </span>
          {target.loop && !isLoopStopped && (
            <span className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
              <Repeat className="h-2.5 w-2.5" />
              Loop
            </span>
          )}
          {isLoopStopped && (
            <span className="inline-flex items-center gap-1 rounded border border-sev-high/30 bg-sev-high/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sev-high">
              <Repeat className="h-2.5 w-2.5" />
              Loop stopped
            </span>
          )}
        </div>

        {/* Tag chips */}
        {target.tags && target.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {target.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
              >
                #{tag}
              </span>
            ))}
            {target.tags.length > 3 && (
              <span className="text-[10px] text-muted-foreground/60">+{target.tags.length - 3}</span>
            )}
          </div>
        )}

        {/* Running progress bar */}
        {target.status === "running" && (
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-sev-info/70" />
          </div>
        )}

        {/* Queued — subtle pending bar */}
        {isQueued && target.status !== "running" && (
          <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-primary/10">
            <div
              className={cn(
                "h-full rounded-full bg-primary/40",
                queuePosition === 1 && "animate-pulse",
              )}
              style={{ width: queuePosition === 1 ? "100%" : `${Math.max(10, 100 - (queuePosition ?? 1) * 15)}%` }}
            />
          </div>
        )}

        {/* Loop stopped — restart prompt (hidden once already queued) */}
        {isLoopStopped && onRestart && !isQueued && (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground">
              Loop paused — restart to re-enable
            </p>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-1 rounded border border-sev-high/40 bg-sev-high/10 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-sev-high hover:bg-sev-high/20 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={cn("h-2.5 w-2.5", restarting && "animate-spin")} />
              {restarting ? "Queuing…" : "Restart"}
            </button>
          </div>
        )}
      </motion.div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemName={target.domain}
        itemType="target"
        description="All associated data will be removed — subdomains, ports, live hosts, screenshots, takeover candidates, and scan history."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </>
  );
}
