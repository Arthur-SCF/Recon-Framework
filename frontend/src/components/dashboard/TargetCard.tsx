import { useState } from "react";
import { motion } from "framer-motion";
import { Trash2, Repeat, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import type { Target } from "@/types/api";

const STATUS_CONFIG: Record<string, { label: string; color: string; border: string }> = {
  idle:         { label: "Idle",         color: "text-muted-foreground",  border: "border-l-muted-foreground/30" },
  running:      { label: "Running",      color: "text-primary",           border: "border-l-primary" },
  completed:    { label: "Done",         color: "text-green-400",         border: "border-l-green-500" },
  paused:       { label: "Paused",       color: "text-yellow-400",        border: "border-l-yellow-500" },
  error:        { label: "Error",        color: "text-destructive",       border: "border-l-destructive" },
  loop_stopped: { label: "Loop stopped", color: "text-amber-500",         border: "border-l-amber-500" },
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
          "group relative rounded-lg border border-border bg-card p-4 text-left transition-all cursor-pointer",
          "hover:border-primary/50 hover:shadow-md",
          "border-l-[3px]",
          cfg.border,
          isQueued && "ring-1 ring-primary/20",
        )}
        onClick={onClick}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.03, duration: 0.25 }}
        whileHover={{ y: -2 }}
      >
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
            "absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium",
            queuePosition === 1
              ? "bg-primary/15 text-primary"
              : "bg-muted/60 text-muted-foreground",
          )}>
            {queuePosition === 1 ? "Next up" : `#${queuePosition}`}
          </span>
        )}

        {/* Domain + status */}
        <div className={cn("flex items-start justify-between gap-2", isQueued && "mt-4")}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {target.domain}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {target.scan_count} scan{target.scan_count !== 1 ? "s" : ""} ·{" "}
              {relativeTime(target.last_scan_at)}
            </p>
          </div>
          <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0", cfg.color)}>
            <span className={cn("h-1.5 w-1.5 rounded-full bg-current", target.status === "running" && "animate-pulse")} />
            {cfg.label}
          </span>
        </div>

        {/* Metadata badges */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            P{target.scan_priority}
          </span>
          <span className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground capitalize">
            {target.wildcard_policy}
          </span>
          {target.loop && !isLoopStopped && (
            <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              <Repeat className="h-2.5 w-2.5" />
              Loop
            </span>
          )}
          {isLoopStopped && (
            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">
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
                className="rounded-full border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground"
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
          <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted/30">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/60" />
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
              className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
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
