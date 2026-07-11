import { useState } from "react";
import { Split } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineGroup, StepRun } from "@/types/api";
import { FlowStepNode } from "./FlowStepNode";

const COLLAPSE_THRESHOLD = 8;

type GroupStatus = "pending" | "running" | "success" | "error" | "mixed";

function getGroupStatus(
  group: PipelineGroup,
  runMap: Record<string, StepRun>,
): GroupStatus {
  const statuses = group.steps.map((s) => runMap[s.step_id]?.status ?? "pending");
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.every((s) => s === "pending")) return "pending";
  if (statuses.every((s) => ["success", "skipped"].includes(s))) return "success";
  if (statuses.some((s) => ["error", "timeout"].includes(s))) return "error";
  return "mixed";
}

function fmtTime(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

interface FlowGroupNodeProps {
  group: PipelineGroup;
  runs: StepRun[];
  /** Show the group name as a separator label (when phase has multiple groups) */
  showLabel?: boolean;
  onViewLog: (stepId: string) => void;
  onViewResults: (stepId: string) => void;
  onRerun: (stepId: string) => void;
  onSkip?: (stepId: string) => void;
  isActive?: boolean;
}

export function FlowGroupNode({
  group,
  runs,
  showLabel = false,
  onViewLog,
  onViewResults,
  onRerun,
  onSkip,
  isActive,
}: FlowGroupNodeProps) {
  const [expanded, setExpanded] = useState(false);

  const runMap = Object.fromEntries(runs.map((r) => [r.step_id, r]));
  const status = getGroupStatus(group, runMap);
  const sortedSteps = [...group.steps].sort((a, b) => a.position - b.position);

  const collapsible = sortedSteps.length > COLLAPSE_THRESHOLD;
  const visibleSteps =
    collapsible && !expanded ? sortedSteps.slice(0, COLLAPSE_THRESHOLD) : sortedSteps;

  const totalTime = runs.reduce((acc, r) => acc + (r.execution_time ?? 0), 0);
  const showTime = totalTime > 0;

  return (
    <div>
      {/* Group label separator — only when the phase has multiple groups */}
      {showLabel && (
        <div
          className={cn(
            "flex items-center gap-3 px-4 pt-3 pb-1.5",
          )}
        >
          <span
            className={cn(
              "font-mono text-[9px] font-semibold uppercase tracking-[0.18em] shrink-0 transition-colors duration-300",
              status === "running"  ? "text-sev-info/70"
              : status === "success" ? "text-sev-low/60"
              : status === "error"   ? "text-sev-critical/70"
              : "text-faint-foreground",
            )}
          >
            {group.name}
          </span>
          {group.parallel && (
            <Split className="h-2.5 w-2.5 shrink-0 text-muted-foreground/30" aria-hidden="true" />
          )}
          {showTime && (
            <span className="ml-auto font-mono text-[9px] text-muted-foreground/20 tabular-nums shrink-0">
              {fmtTime(totalTime)}
            </span>
          )}
          <div className="flex-1 h-px bg-border ml-0" />
        </div>
      )}

      {/* Step rows — flat, no nesting */}
      <div className="flex flex-col">
        {visibleSteps.map((step) => (
          <FlowStepNode
            key={step.id}
            step={step}
            run={runMap[step.step_id]}
            onViewLog={onViewLog}
            onViewResults={onViewResults}
            onRerun={onRerun}
            onSkip={onSkip}
            isActive={isActive}
          />
        ))}

        {collapsible && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-2 px-4 py-[7px] font-mono text-[11px] tabular-nums text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
          >
            <span>+{sortedSteps.length - COLLAPSE_THRESHOLD} more</span>
          </button>
        )}

        {collapsible && expanded && (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-2 px-4 py-[7px] text-[11px] text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}
