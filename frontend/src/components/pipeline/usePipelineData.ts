import { useCallback, useEffect, useRef, useState } from "react";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import type { PipelineGroup, ScanSession, StepRun } from "@/types/api";
import { reportSuccess, reportFailure, registerRefreshCallback } from "@/hooks/useApiHealth";
import { useActionFetch } from "@/hooks/useActionFetch";

export interface UsePipelineDataReturn {
  groups: PipelineGroup[];
  session: ScanSession | null;
  runs: StepRun[];
  loading: boolean;
  pending: boolean;
  isRunning: boolean;
  isPaused: boolean;
  doAction: (action: "start" | "pause" | "resume" | "cancel") => Promise<void>;
  doRerun: (stepId: string) => Promise<void>;
  doSkip: (stepId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

// WebSocket event types that indicate pipeline state has changed
const WS_PIPELINE_EVENTS = [
  "scan_started",
  "scan_paused",
  "scan_resumed",
  "scan_completed",
  "scan_failed",
  "step_started",
  "step_completed",
  "step_failed",
  "step_skipped",
];

export function usePipelineData(targetId: string): UsePipelineDataReturn {
  const { actionFetch } = useActionFetch();
  const [groups, setGroups] = useState<PipelineGroup[]>([]);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [runs, setRuns] = useState<StepRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSessionRef = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [groupsRes, sessionsRes] = await Promise.all([
        fetch(`/api/v1/targets/${targetId}/pipeline`),
        fetch(`/api/v1/targets/${targetId}/sessions`),
      ]);
      if (groupsRes.ok) setGroups(await groupsRes.json() as PipelineGroup[]);
      if (sessionsRes.ok) {
        const sessions = (await sessionsRes.json()) as ScanSession[];
        const active =
          sessions.find((s) => ["running", "paused"].includes(s.status)) ??
          sessions[0] ??
          null;
        setSession(active);
        if (active) {
          const stepsRes = await fetch(
            `/api/v1/targets/${targetId}/sessions/${active.id}/steps`,
          );
          if (stepsRes.ok) setRuns(await stepsRes.json() as StepRun[]);
        } else {
          setRuns([]);
        }
      }
      reportSuccess();
    } catch {
      reportFailure();
      // network error — keep stale state
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  // Initial fetch + 30s stale-data fallback (replaces 3s polling)
  useEffect(() => {
    void fetchAll();
    fallbackTimerRef.current = setInterval(() => void fetchAll(), 30_000);
    return () => {
      if (fallbackTimerRef.current) clearInterval(fallbackTimerRef.current);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [fetchAll]);

  // Register fetchAll with forceRefreshAll
  useEffect(() => {
    return registerRefreshCallback(fetchAll);
  }, [fetchAll]);

  // WebSocket: re-fetch on any pipeline event for this target
  useWsSubscribe(WS_PIPELINE_EVENTS, () => void fetchAll(), targetId);

  const status = session?.status ?? null;
  const isRunning = status === "running";
  const isPaused = status === "paused";

  // Clear pending once a NEW session actually starts running
  useEffect(() => {
    if (!pending) return;
    if (
      session &&
      session.id !== pendingSessionRef.current &&
      status === "running"
    ) {
      setPending(false);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    }
  }, [session, status, pending]);

  const doAction = useCallback(
    async (action: "start" | "pause" | "resume" | "cancel") => {
      if (action === "start") {
        pendingSessionRef.current = session?.id ?? null;
        setPending(true);
        pendingTimerRef.current = setTimeout(() => setPending(false), 30_000);
      }
      const actionLabel: Record<string, string> = {
        start: "start scan", pause: "pause scan",
        resume: "resume scan", cancel: "cancel scan",
      };
      await actionFetch(`/api/v1/targets/${targetId}/${action}`, {
        method: "POST",
        errorPrefix: `Failed to ${actionLabel[action] ?? action}`,
      });
      void fetchAll();
    },
    [targetId, session, fetchAll, actionFetch],
  );

  const doRerun = useCallback(
    async (stepId: string) => {
      if (!session) return;
      await actionFetch(
        `/api/v1/targets/${targetId}/sessions/${session.id}/steps/${stepId}/rerun`,
        { method: "POST", errorPrefix: "Failed to rerun step" },
      );
      void fetchAll();
    },
    [targetId, session, fetchAll, actionFetch],
  );

  const doSkip = useCallback(
    async (stepId: string) => {
      if (!session) return;
      await actionFetch(
        `/api/v1/targets/${targetId}/sessions/${session.id}/steps/${stepId}/skip`,
        { method: "POST", errorPrefix: "Failed to skip step" },
      );
      void fetchAll();
    },
    [targetId, session, fetchAll, actionFetch],
  );

  return {
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
    refresh: fetchAll,
  };
}
