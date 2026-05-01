import { useCallback, useEffect, useState } from "react";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import { reportSuccess, reportFailure, registerRefreshCallback } from "@/hooks/useApiHealth";

export interface ActiveScan {
  session_id: string;
  target_id: string;
  domain: string;
  loop: boolean;
  status: string;
  started_at: string | null;
  steps_done: number;
  steps_total: number;
  current_step: string | null;
}

export interface QueueItem {
  target_id: string;
  domain: string;
  scan_priority: number;
  loop: boolean;
}

export interface NextScheduled {
  target_id: string;
  domain: string;
  schedule_mode: "hourly" | "daily" | "weekly";
  rescan_interval: number;
  schedule_days: number;
  schedule_weekday: number;
  schedule_hour: number;
  schedule_minute: number;
  next_run_at: string;
  is_due: boolean;
}

export interface SchedulerState {
  active: ActiveScan | null;
  queue: QueueItem[];
  scheduled: NextScheduled[];
  next_scheduled: NextScheduled | null;
  next_loop: { target_id: string; domain: string } | null;
  loops_paused: boolean;
  queue_paused: boolean;
}

/**
 * Polls /api/v1/scheduler/state every `intervalMs` milliseconds.
 * Share this hook between Dashboard and sidebar widgets by lifting state
 * up; or use independently — each instance makes its own requests.
 */
export function useSchedulerState(intervalMs = 5000) {
  const [state, setState] = useState<SchedulerState | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/scheduler/state");
      if (res.ok) {
        setState((await res.json()) as SchedulerState);
        reportSuccess();
      } else {
        reportFailure();
      }
    } catch {
      reportFailure();
      // keep last known state
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  // Register with forceRefreshAll
  useEffect(() => {
    return registerRefreshCallback(refresh);
  }, [refresh]);

  // Refresh immediately on scan lifecycle events instead of waiting for next poll
  useWsSubscribe(
    ["scan_queued", "scan_started", "scan_completed", "scan_error",
     "scan_paused", "scan_resumed", "scan_cancelled"],
    () => void refresh(),
  );

  return { state, refresh };
}

/** Build a map of target_id → queue position (1-based) from scheduler state. */
export function buildQueuePositionMap(state: SchedulerState | null): Map<string, number> {
  const m = new Map<string, number>();
  if (!state) return m;
  // queue[0] = position 1 (next to run), queue[1] = position 2, etc.
  state.queue.forEach((q, i) => m.set(q.target_id, i + 1));
  return m;
}
