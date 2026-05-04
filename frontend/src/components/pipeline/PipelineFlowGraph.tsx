import { Fragment, useMemo } from "react";
import * as Accordion from "@radix-ui/react-accordion";
import {
  Check,
  CheckCircle2,
  Circle,
  ChevronDown,
  Loader2,
  AlertCircle,
  XCircle,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineGroup, StepRun } from "@/types/api";
import { FlowGroupNode } from "./FlowGroupNode";

// ── Phase definitions ───────────────────────────────────────────────────────

const PHASES = [
  { id: "passive",     label: "Passive Reconnaissance", short: "Passive"     },
  { id: "validation",  label: "Subdomain Validation",   short: "Validation"  },
  { id: "permutation", label: "Permutation Expansion",  short: "Permutation" },
  { id: "content",     label: "Content Discovery",      short: "Content"     },
  { id: "analysis",    label: "Target Analysis",        short: "Analysis"    },
  { id: "reporting",   label: "Reporting",              short: "Reporting"   },
] as const;

type PhaseId = (typeof PHASES)[number]["id"];

function getPhaseId(group: PipelineGroup): PhaseId {
  if (group.steps.some((s) => s.step_id === "diff" || s.step_id === "verify_dedup"))
    return "reporting";
  const p = group.position;
  if (p === 1)  return "passive";
  if (p <= 4)   return "validation";
  if (p <= 8)   return "permutation";
  if (p <= 11)  return "content";
  return "analysis";
}

// ── Phase status ────────────────────────────────────────────────────────────

type PhaseStatus = "pending" | "running" | "success" | "error" | "mixed";

function getPhaseStatus(
  phaseGroups: PipelineGroup[],
  runs: StepRun[],
): PhaseStatus {
  const runMap = Object.fromEntries(runs.map((r) => [r.step_id, r]));
  const statuses = phaseGroups.flatMap((g) =>
    g.steps.map((s) => runMap[s.step_id]?.status ?? "pending"),
  );
  if (statuses.length === 0) return "pending";
  if (statuses.some((s) => s === "running")) return "running";
  if (statuses.every((s) => s === "pending")) return "pending";
  if (statuses.every((s) => ["success", "skipped"].includes(s))) return "success";
  if (statuses.some((s) => ["error", "timeout"].includes(s))) return "error";
  return "mixed";
}

// Status icons for the accordion trigger
const PHASE_ICON: Record<PhaseStatus, React.ReactNode> = {
  pending: <Circle       className="h-4 w-4 shrink-0 text-muted-foreground/25" />,
  running: <Loader2      className="h-4 w-4 shrink-0 text-blue-400 animate-spin" />,
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />,
  error:   <XCircle      className="h-4 w-4 shrink-0 text-red-400" />,
  mixed:   <AlertCircle  className="h-4 w-4 shrink-0 text-yellow-400" />,
};

// Left-border on accordion trigger
const PHASE_LEFT_BORDER: Record<PhaseStatus, string> = {
  pending:  "border-l-border/30",
  running:  "border-l-blue-500",
  success:  "border-l-green-500",
  error:    "border-l-red-500",
  mixed:    "border-l-yellow-500",
};

// ── Component ───────────────────────────────────────────────────────────────

interface PipelineFlowGraphProps {
  groups: PipelineGroup[];
  runs: StepRun[];
  onViewLog: (stepId: string) => void;
  onViewResults: (stepId: string) => void;
  onRerun: (stepId: string) => void;
  onSkip?: (stepId: string) => void;
  isActive?: boolean;
}

export function PipelineFlowGraph({
  groups,
  runs,
  onViewLog,
  onViewResults,
  onRerun,
  onSkip,
  isActive,
}: PipelineFlowGraphProps) {
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.position - b.position),
    [groups],
  );

  const runMap = useMemo(
    () => Object.fromEntries(runs.map((r) => [r.step_id, r])),
    [runs],
  );

  const groupRuns = useMemo(() => {
    const map = new Map<string, StepRun[]>();
    for (const group of sortedGroups) {
      const stepIds = new Set(group.steps.map((s) => s.step_id));
      map.set(group.id, runs.filter((r) => stepIds.has(r.step_id)));
    }
    return map;
  }, [sortedGroups, runs]);

  const groupsByPhase = useMemo(() => {
    const map = new Map<PhaseId, PipelineGroup[]>();
    for (const group of sortedGroups) {
      const pid = getPhaseId(group);
      map.set(pid, [...(map.get(pid) ?? []), group]);
    }
    return map;
  }, [sortedGroups]);

  const visiblePhases = PHASES.filter(
    (p) => (groupsByPhase.get(p.id) ?? []).length > 0,
  );

  // Smart defaultValue: if no runs → open all; else open only non-completed phases
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const defaultOpenPhases = useMemo(() => {
    if (runs.length === 0) return visiblePhases.map((p) => p.id);
    return visiblePhases
      .filter((p) => getPhaseStatus(groupsByPhase.get(p.id) ?? [], runs) !== "success")
      .map((p) => p.id);
  // computed once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl bg-card/90 backdrop-blur-xl border border-white/[0.07] shadow-lg shadow-black/20 overflow-hidden">

      {/* Primary accent bar */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent shrink-0" />

      {/* ── Phase stepper strip ─────────────────────────────────────────── */}
      <div className="flex items-start px-3 sm:px-5 py-4 border-b border-white/[0.05] bg-white/[0.015] overflow-x-auto gap-0">
        {visiblePhases.map((phase, i) => {
          const phaseGroups = groupsByPhase.get(phase.id) ?? [];
          const phaseRuns   = phaseGroups.flatMap((g) => groupRuns.get(g.id) ?? []);
          const phaseStatus = getPhaseStatus(phaseGroups, phaseRuns);

          // Connecting line uses the PREVIOUS phase's status
          const prevComplete = i > 0 && (() => {
            const prev = visiblePhases[i - 1];
            const pg = groupsByPhase.get(prev.id) ?? [];
            return getPhaseStatus(pg, pg.flatMap((g) => groupRuns.get(g.id) ?? [])) === "success";
          })();

          return (
            <Fragment key={phase.id}>
              {/* Connecting line between phases */}
              {i > 0 && (
                <div
                  className={cn(
                    "flex-1 h-px min-w-[12px] mt-[10px] mx-1 transition-colors duration-500",
                    prevComplete ? "bg-green-500/25" : "bg-border/15",
                  )}
                />
              )}

              {/* Phase indicator */}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                {/* Circle */}
                <div
                  className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300",
                    phaseStatus === "success"
                      ? "bg-green-400/15 ring-1 ring-green-500/40 text-green-400"
                      : phaseStatus === "running"
                        ? "bg-blue-400/15 ring-1 ring-blue-500/40 text-blue-400"
                        : phaseStatus === "error"
                          ? "bg-red-400/15 ring-1 ring-red-500/40 text-red-400"
                          : "bg-muted/20 ring-1 ring-border/20 text-muted-foreground/25",
                  )}
                >
                  {phaseStatus === "success" ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : phaseStatus === "running" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : phaseStatus === "error" ? (
                    <X className="h-2.5 w-2.5" />
                  ) : (
                    <span className="text-[8px] font-bold leading-none">{i + 1}</span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-[9px] font-medium whitespace-nowrap transition-colors duration-300",
                    phaseStatus === "running"   ? "text-blue-300/80"
                    : phaseStatus === "success"  ? "text-green-400/50"
                    : phaseStatus === "error"    ? "text-red-400/60"
                    : "text-muted-foreground/25",
                  )}
                >
                  {phase.short}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* ── Phase accordion ─────────────────────────────────────────────── */}
      <Accordion.Root
        type="multiple"
        defaultValue={defaultOpenPhases}
        className="flex flex-col"
      >
        {visiblePhases.map((phase) => {
          const phaseGroups = groupsByPhase.get(phase.id) ?? [];
          const phaseRuns   = phaseGroups.flatMap((g) => groupRuns.get(g.id) ?? []);
          const phaseStatus = getPhaseStatus(phaseGroups, phaseRuns);
          const allSteps    = phaseGroups.flatMap((g) => g.steps);
          const stepCount   = allSteps.length;
          const doneCount   = allSteps.filter((s) => {
            const r = runMap[s.step_id];
            return r && ["success", "skipped", "error", "timeout"].includes(r.status);
          }).length;
          const multiGroup  = phaseGroups.length > 1;

          return (
            <Accordion.Item
              key={phase.id}
              value={phase.id}
              className="border-t border-white/[0.05] first:border-t-0"
            >
              {/* ── Trigger ── */}
              <Accordion.Header asChild>
                <div>
                  <Accordion.Trigger
                    className={cn(
                      "group/trigger flex w-full items-center gap-3 px-4 py-3.5",
                      "transition-all duration-150",
                      "border-l-[3px]",
                      PHASE_LEFT_BORDER[phaseStatus],
                      phaseStatus === "running"
                        ? "bg-blue-500/[0.07] hover:bg-blue-500/[0.10]"
                        : phaseStatus === "success"
                          ? "hover:bg-white/[0.02]"
                          : "hover:bg-white/[0.03]",
                    )}
                  >
                    {/* Status icon */}
                    {PHASE_ICON[phaseStatus]}

                    {/* Phase label */}
                    <span
                      className={cn(
                        "flex-1 text-left text-sm transition-colors duration-300",
                        phaseStatus === "pending"
                          ? "text-muted-foreground/50 font-normal"
                          : phaseStatus === "success"
                            ? "text-muted-foreground/60 font-medium"
                            : "text-foreground font-medium",
                      )}
                    >
                      {phase.label}
                    </span>

                    {/* Step count — show progress when a run is active */}
                    <span className="font-mono text-[10px] text-muted-foreground/30 tabular-nums">
                      {runs.length > 0 && doneCount > 0
                        ? `${doneCount} / ${stepCount}`
                        : stepCount}
                    </span>

                    {/* Chevron */}
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 text-muted-foreground/25",
                        "transition-transform duration-200",
                        "group-data-[state=open]/trigger:rotate-180",
                      )}
                    />
                  </Accordion.Trigger>
                </div>
              </Accordion.Header>

              {/* ── Content ── */}
              <Accordion.Content className="pipeline-accordion-content">
                <div className="py-1 pb-3">
                  {phaseGroups.map((group) => (
                    <FlowGroupNode
                      key={group.id}
                      group={group}
                      runs={groupRuns.get(group.id) ?? []}
                      showLabel={multiGroup}
                      onViewLog={onViewLog}
                      onViewResults={onViewResults}
                      onRerun={onRerun}
                      onSkip={onSkip}
                      isActive={isActive}
                    />
                  ))}
                </div>
              </Accordion.Content>
            </Accordion.Item>
          );
        })}
      </Accordion.Root>
    </div>
  );
}
