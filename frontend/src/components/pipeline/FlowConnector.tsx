import { cn } from "@/lib/utils";
import type { PipelineGroup, StepRun } from "@/types/api";

type ConnectorStatus = "pending" | "active" | "complete";

export function getConnectorStatus(
  group: PipelineGroup,
  runs: StepRun[],
): ConnectorStatus {
  const runMap = Object.fromEntries(runs.map((r) => [r.step_id, r]));
  const statuses = group.steps.map((s) => runMap[s.step_id]?.status ?? "pending");
  const allDone = statuses.every((s) => ["success", "skipped"].includes(s));
  if (allDone) return "complete";
  if (statuses.some((s) => s === "running" || s === "success")) return "active";
  return "pending";
}

interface FlowConnectorProps {
  status: ConnectorStatus;
}

export function FlowConnector({ status }: FlowConnectorProps) {
  return (
    <div className="flex justify-center py-1">
      <div
        className={cn(
          "h-6 transition-colors duration-300",
          status === "complete"
            ? "border-l-2 border-sev-low/40"
            : status === "active"
              ? "border-l-2 border-sev-info/50 animate-pulse"
              : "border-l border-dashed border-border/40",
        )}
      />
    </div>
  );
}
