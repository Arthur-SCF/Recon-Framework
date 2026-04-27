import { useCallback, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { usePipelineData } from "./usePipelineData";
import { PipelineControls } from "./PipelineControls";
import { PipelineFlowGraph } from "./PipelineFlowGraph";
import { FlowLegend } from "./FlowLegend";
import { LogModal } from "./LogModal";
import { ResultsModal } from "./ResultsModal";

interface PipelineFlowProps {
  targetId: string;
  wildcardPolicy?: string;
  isQueued?: boolean;
  queuePosition?: number;
  onDequeued?: () => void;
}

export function PipelineFlow({ targetId, wildcardPolicy, isQueued = false, queuePosition, onDequeued }: PipelineFlowProps) {
  const {
    groups,
    session,
    runs,
    loading,
    pending,
    isRunning,
    isPaused,
    doAction,
    doRerun,
    doSkip,
    refresh,
  } = usePipelineData(targetId);

  const [logStep, setLogStep] = useState<string | null>(null);
  const [resultsStep, setResultsStep] = useState<string | null>(null);

  const handleDequeue = useCallback(async () => {
    await fetch(`/api/v1/scheduler/queue/${targetId}`, { method: "DELETE" });
    await refresh();
    onDequeued?.();
  }, [targetId, refresh, onDequeued]);

  return (
    <div className="flex flex-col gap-3">
      {/* Wildcard detection badge */}
      {wildcardPolicy && wildcardPolicy !== "disabled" && (
        <div className="flex items-center gap-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground w-fit">
          <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
          Wildcard detection active
          <span className="rounded px-1.5 py-0.5 bg-muted/50 font-medium text-foreground capitalize">
            {wildcardPolicy}
          </span>
        </div>
      )}

      {/* Controls bar */}
      <PipelineControls
        session={session}
        isRunning={isRunning}
        isPaused={isPaused}
        pending={pending}
        isQueued={isQueued}
        queuePosition={queuePosition}
        onAction={(action) => void doAction(action)}
        onDequeue={() => void handleDequeue()}
      />

      {/* Flow graph */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No pipeline configured.</p>
        </div>
      ) : (
        <PipelineFlowGraph
          groups={groups}
          runs={runs}
          onViewLog={setLogStep}
          onViewResults={setResultsStep}
          onRerun={(stepId) => void doRerun(stepId)}
          onSkip={(stepId) => void doSkip(stepId)}
          isActive={isRunning}
        />
      )}

      {/* Legend */}
      {groups.length > 0 && (
        <div className="flex justify-end">
          <FlowLegend />
        </div>
      )}

      {/* Log modal */}
      {logStep && session && (
        <LogModal
          targetId={targetId}
          sessionId={session.id}
          stepId={logStep}
          onClose={() => setLogStep(null)}
        />
      )}

      {/* Results modal */}
      {resultsStep && session && (
        <ResultsModal
          targetId={targetId}
          sessionId={session.id}
          stepId={resultsStep}
          onClose={() => setResultsStep(null)}
        />
      )}
    </div>
  );
}
