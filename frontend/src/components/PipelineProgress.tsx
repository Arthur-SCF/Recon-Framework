import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  SkipForward,
  Clock,
  Play,
  Pause,
  Square,
  ChevronDown,
  ChevronRight,
  RotateCw,
  ExternalLink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineGroup, ScanSession, StepRun } from "@/types/api";

const PAUSE_LABELS: Record<string, string> = {
  manual:        "manual",
  auto:          "preempted",
  auto_recovery: "crash recovery",
  wildcard:      "wildcard detected",
  shutdown:      "shutdown",
};

// ── Status helpers ─────────────────────────────────────────────────────────────

const STEP_STATUS_ICON: Record<string, React.ReactNode> = {
  pending:  <Circle          className="h-4 w-4 text-muted-foreground" />,
  running:  <Loader2         className="h-4 w-4 text-sev-info animate-spin" />,
  success:  <CheckCircle2    className="h-4 w-4 text-sev-low" />,
  error:    <AlertCircle     className="h-4 w-4 text-sev-critical" />,
  timeout:  <Clock           className="h-4 w-4 text-sev-medium" />,
  skipped:  <SkipForward     className="h-4 w-4 text-faint-foreground" />,
};

function fmt_time(sec: number | null): string {
  if (sec === null) return "";
  if (sec < 60) return `${sec.toFixed(1)}s`;
  return `${Math.floor(sec / 60)}m${Math.round(sec % 60)}s`;
}

// ── Step row ───────────────────────────────────────────────────────────────────

function StepRow({
  step,
  run,
  onViewLog,
  onViewResults,
  onRerun,
}: {
  step: { step_id: string; position: number };
  run: StepRun | undefined;
  onViewLog: (stepId: string) => void;
  onViewResults: (stepId: string) => void;
  onRerun: (stepId: string) => void;
}) {
  const status = run?.status ?? "pending";
  const done = status === "success" || status === "error" || status === "timeout";
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded px-3 py-1.5 text-xs",
        status === "running" ? "bg-sev-info/5" : "hover:bg-surface-hover",
      )}
    >
      <span className="shrink-0">{STEP_STATUS_ICON[status] ?? STEP_STATUS_ICON.pending}</span>
      <span className={cn(
        "flex-1 font-mono",
        status === "skipped" ? "text-muted-foreground line-through" : "text-foreground",
      )}>
        {step.step_id}
      </span>
      {run?.result_count != null && (
        done && run.result_count > 0 ? (
          <button
            onClick={() => onViewResults(step.step_id)}
            className="font-mono tabular-nums text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
          >
            {run.result_count} results
          </button>
        ) : (
          <span className="font-mono tabular-nums text-muted-foreground">{run.result_count} results</span>
        )
      )}
      {run?.execution_time != null && (
        <span className="font-mono tabular-nums text-muted-foreground">{fmt_time(run.execution_time)}</span>
      )}
      {done && (
        <button
          onClick={() => onViewLog(step.step_id)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          logs
        </button>
      )}
      {done && (
        <button
          onClick={() => onRerun(step.step_id)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Rerun this step"
        >
          <RotateCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ── Group row ──────────────────────────────────────────────────────────────────

function GroupRow({
  group,
  runs,
  onViewLog,
  onViewResults,
  onRerun,
}: {
  group: PipelineGroup;
  runs: StepRun[];
  onViewLog: (stepId: string) => void;
  onViewResults: (stepId: string) => void;
  onRerun: (stepId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  const runMap = Object.fromEntries(runs.map((r) => [r.step_id, r]));
  const hasRunning = group.steps.some((s) => runMap[s.step_id]?.status === "running");
  const allDone    = group.steps.every((s) =>
    ["success", "skipped", "error", "timeout"].includes(runMap[s.step_id]?.status ?? "pending")
  );

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium hover:bg-surface-hover transition-colors"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="flex-1">{group.name}</span>
        {group.parallel && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
            parallel
          </span>
        )}
        {hasRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-sev-info" />}
        {!hasRunning && allDone && (
          <CheckCircle2 className="h-3.5 w-3.5 text-sev-low" />
        )}
      </button>

      {open && (
        <div className="border-t border-border px-2 pb-2 pt-1 space-y-0.5">
          {group.steps
            .sort((a, b) => a.position - b.position)
            .map((step) => (
              <StepRow
                key={step.id}
                step={step}
                run={runMap[step.step_id]}
                onViewLog={onViewLog}
                onViewResults={onViewResults}
                onRerun={onRerun}
              />
            ))}
        </div>
      )}
    </div>
  );
}

// ── Log viewer modal ───────────────────────────────────────────────────────────

function LogModal({
  targetId,
  sessionId,
  stepId,
  onClose,
}: {
  targetId: string;
  sessionId: string;
  stepId: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch(`/api/v1/targets/${targetId}/sessions/${sessionId}/steps/${stepId}/stdout`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { content: string }) => setContent(d.content))
      .catch(() => setContent(null))
      .finally(() => setLoading(false));
  }, [targetId, sessionId, stepId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] m-4 rounded-lg border border-border bg-popover shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-sm font-medium">{stepId} — stdout</span>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground/40 hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : content === null ? (
            <p className="text-sm text-muted-foreground">No output available.</p>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap text-foreground">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Results modal ──────────────────────────────────────────────────────────────

interface StepResultsData {
  type: "subdomains" | "live_hosts" | "screenshots" | "takeovers" | "list" | "none";
  count: number;
  items: string[];
}

function ResultsModal({
  targetId,
  sessionId,
  stepId,
  onClose,
}: {
  targetId: string;
  sessionId: string;
  stepId: string;
  onClose: () => void;
}) {
  const [data,    setData]    = useState<StepResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState("");

  useEffect(() => {
    void fetch(`/api/v1/targets/${targetId}/sessions/${sessionId}/steps/${stepId}/results`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: StepResultsData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [targetId, sessionId, stepId]);

  const filtered = data?.items.filter((item) =>
    !filter || item.includes(filter.toLowerCase())
  ) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[80vh] m-4 rounded-lg border border-border bg-popover shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-medium">{stepId} — results</span>
            {data && (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {filter ? `${filtered.length} / ${data.items.length}` : `${data.count} total`}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground/40 hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filter (only when there are items) */}
        {data && data.items.length > 0 && (
          <div className="border-b border-border px-4 py-2">
            <input
              autoFocus
              type="text"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 w-full rounded border border-border bg-muted/30 px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : data === null ? (
            <p className="text-sm text-muted-foreground">Failed to load results.</p>
          ) : data.type === "live_hosts" ? (
            <p className="text-sm text-muted-foreground">
              {data.count} live host{data.count !== 1 ? "s" : ""} found — view them in the{" "}
              <strong className="text-foreground">Live Hosts</strong> tab.
            </p>
          ) : data.type === "screenshots" ? (
            <p className="text-sm text-muted-foreground">
              {data.count} screenshot{data.count !== 1 ? "s" : ""} taken — view them in the{" "}
              <strong className="text-foreground">Live Hosts</strong> tab (expand any row).
            </p>
          ) : data.type === "takeovers" && data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No takeover candidates found.
            </p>
          ) : data.type === "takeovers" ? (
            <div className="space-y-px">
              {filtered.map((item) => (
                <div key={item} className="rounded px-1 py-0.5 font-mono text-xs text-foreground hover:bg-surface-hover">
                  {item}
                </div>
              ))}
              {filtered.length === 0 && filter && (
                <p className="py-4 text-center text-xs text-muted-foreground">No matches.</p>
              )}
            </div>
          ) : data.type === "none" || data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {data.count > 0
                ? `${data.count} results recorded — no detail view available for this step type.`
                : "No results for this step."}
            </p>
          ) : (
            <div className="space-y-px">
              {filtered.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-hover group"
                >
                  <span className="flex-1 font-mono text-xs text-foreground">{item}</span>
                  {data.type === "subdomains" && (
                    <a
                      href={`https://${item}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              ))}
              {filtered.length === 0 && filter && (
                <p className="py-4 text-center text-xs text-muted-foreground">No matches.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main component ─────────────────────────────────────────────────────────────

export function PipelineProgress({ targetId }: { targetId: string }) {
  const [groups,  setGroups]  = useState<PipelineGroup[]>([]);
  const [session, setSession] = useState<ScanSession | null>(null);
  const [runs,    setRuns]    = useState<StepRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [logStep,     setLogStep]     = useState<string | null>(null);
  const [resultsStep, setResultsStep] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [groupsRes, sessionsRes] = await Promise.all([
        fetch(`/api/v1/targets/${targetId}/pipeline`),
        fetch(`/api/v1/targets/${targetId}/sessions`),
      ]);
      if (groupsRes.ok)   setGroups(await groupsRes.json() as PipelineGroup[]);
      if (sessionsRes.ok) {
        const sessions = await sessionsRes.json() as ScanSession[];
        const active = sessions.find((s) =>
          ["running", "paused"].includes(s.status)
        ) ?? sessions[0] ?? null;
        setSession(active);
        if (active) {
          const stepsRes = await fetch(
            `/api/v1/targets/${targetId}/sessions/${active.id}/steps`
          );
          if (stepsRes.ok) setRuns(await stepsRes.json() as StepRun[]);
        } else {
          setRuns([]);
        }
      }
    } catch (_) {
      // network error — ignore, keep stale state
    } finally {
      setLoading(false);
    }
  }, [targetId]);

  useEffect(() => {
    void fetchAll();
    // Poll every 3 seconds when a scan is active
    pollRef.current = setInterval(() => void fetchAll(), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [fetchAll]);

  async function doAction(action: "start" | "pause" | "resume" | "cancel") {
    if (action === "start") {
      // Remember which session existed BEFORE we clicked, so the useEffect
      // only clears pending when a genuinely NEW session appears as "running".
      pendingSessionRef.current = session?.id ?? null;
      setPending(true);
      pendingTimerRef.current = setTimeout(() => setPending(false), 30_000);
    }
    await fetch(`/api/v1/targets/${targetId}/${action}`, { method: "POST" });
    void fetchAll();
  }

  async function doRerun(stepId: string) {
    if (!session) return;
    await fetch(
      `/api/v1/targets/${targetId}/sessions/${session.id}/steps/${stepId}/rerun`,
      { method: "POST" },
    );
    void fetchAll();
  }

  const [pending, setPending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the session ID at the moment "Start" was clicked so we can detect
  // when a NEW session appears (not just any truthy status from a prior scan).
  const pendingSessionRef = useRef<string | null>(null);

  const status = session?.status ?? null;
  const isRunning = status === "running";
  const isPaused  = status === "paused";

  // Clear pending once a NEW session actually starts running
  useEffect(() => {
    if (!pending) return;
    // A new session appeared that wasn't there when we clicked Start
    if (session && session.id !== pendingSessionRef.current && status === "running") {
      setPending(false);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    }
  }, [session, status, pending]);

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {!isRunning && !isPaused && (
          <button
            onClick={() => void doAction("start")}
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
        )}
        {isRunning && (
          <button
            onClick={() => void doAction("pause")}
            className="flex items-center gap-1.5 rounded-md bg-sev-medium/20 border border-sev-medium/40 px-3 py-1.5 text-xs font-medium text-sev-medium hover:bg-sev-medium/30 transition-colors"
          >
            <Pause className="h-3 w-3" /> Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={() => void doAction("resume")}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Play className="h-3 w-3" /> Resume
          </button>
        )}
        {(isRunning || isPaused) && (
          <button
            onClick={() => void doAction("cancel")}
            className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 transition-colors"
          >
            <Square className="h-3 w-3" /> Cancel
          </button>
        )}
        {session && (
          <span className="ml-2 font-mono text-xs text-muted-foreground capitalize">
            {session.status}
            {session.pause_type ? ` (${PAUSE_LABELS[session.pause_type] ?? session.pause_type})` : ""}
          </span>
        )}
        <button
          onClick={() => void fetchAll()}
          className="ml-auto rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Groups */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {groups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              runs={runs.filter((r) =>
                g.steps.some((s) => s.step_id === r.step_id)
              )}
              onViewLog={(stepId) => setLogStep(stepId)}
              onViewResults={(stepId) => setResultsStep(stepId)}
              onRerun={(stepId) => void doRerun(stepId)}
            />
          ))}
          {groups.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No pipeline configured.
            </p>
          )}
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
