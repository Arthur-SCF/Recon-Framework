import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSchedulerState, buildQueuePositionMap } from "@/hooks/useSchedulerState";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import * as Tabs from "@radix-ui/react-tabs";
import { AlertTriangle, Loader2, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { EditTargetModal } from "@/components/EditTargetModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/PageTransition";
import type { Target, PipelineGroup } from "@/types/api";
import { PipelineFlow } from "@/components/pipeline/PipelineFlow";
import { TargetConfig } from "@/components/config/TargetConfig";
import { ScopeRuleEditor } from "@/components/ScopeRuleEditor";
import { SubdomainsTable } from "@/components/SubdomainsTable";
import { LiveHostsView } from "@/components/hosts/LiveHostsView";
import { TakeoverTable } from "@/components/TakeoverTable";
import { CloudTable } from "@/components/CloudTable";
import { ExportMenu } from "@/components/ExportMenu";
import { DiffCompareView } from "@/components/charts/DiffCompareView";
import { PortsWithChart } from "@/components/charts/PortsWithChart";
import { ScreenshotGallery } from "@/components/ScreenshotGallery";

// All tabs with optional step-presence requirements.
// A tab is visible when it has no requiredSteps OR at least one
// of its requiredSteps is present in the target's pipeline.
const ALL_TABS = [
  { id: "pipeline",    label: "Pipeline" },
  { id: "config",      label: "Config" },
  { id: "subdomains",  label: "Subdomains" },
  { id: "hosts",       label: "Live Hosts" },
  { id: "ports",       label: "Ports",       requiredSteps: ["naabu", "zgrab2_service", "nmap_service", "httpx_ports"] },
  { id: "cloud",       label: "Cloud",       requiredSteps: ["cloud_enum", "s3scanner"] },
  { id: "takeover",    label: "Takeover",    requiredSteps: ["nuclei_takeover"] },
  { id: "history",     label: "History" },
  { id: "scope",       label: "Scope" },
  { id: "screenshots", label: "Screenshots", requiredSteps: ["gowitness"] },
];

const STATUS_DOT: Record<string, string> = {
  idle:         "bg-muted-foreground",
  running:      "bg-primary animate-pulse",
  completed:    "bg-green-400",
  paused:       "bg-yellow-400",
  error:        "bg-destructive",
  loop_stopped: "bg-amber-500",
};

const STATUS_LABEL: Record<string, string> = {
  idle:         "Idle",
  running:      "Running",
  completed:    "Completed",
  paused:       "Paused",
  error:        "Error",
  loop_stopped: "Loop stopped",
};

export function TargetDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state: schedulerState, refresh: refreshSchedulerState } = useSchedulerState();
  const queuePositionMap = buildQueuePositionMap(schedulerState ?? null);
  const isQueued = id ? queuePositionMap.has(id) : false;
  const [target,   setTarget]   = useState<Target | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting,   setDeleting]   = useState(false);
  const [editOpen,     setEditOpen]     = useState(false);
  const [restarting,   setRestarting]   = useState(false);
  const [pipelineStepIds, setPipelineStepIds] = useState<Set<string>>(new Set());

  async function handleRestart() {
    if (!id) return;
    setRestarting(true);
    try {
      const res = await fetch(`/api/v1/targets/${id}/start`, { method: "POST" });
      if (res.ok) {
        // Optimistically clear loop_stopped so the button disappears immediately
        setTarget((t) => t ? { ...t, status: "idle" } : t);
      }
    } finally {
      setRestarting(false);
    }
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/targets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      navigate("/");
    } catch {
      setDeleting(false);
    }
  }

  const refreshTarget = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/v1/targets/${id}`);
    if (res.ok) setTarget(await res.json() as Target);
  }, [id]);

  const refreshPipelineStepIds = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/v1/targets/${id}/pipeline`);
    if (!res.ok) return;
    const data = await res.json() as PipelineGroup[];
    const ids = new Set<string>(data.flatMap((g) => g.steps.map((s) => s.step_id)));
    setPipelineStepIds(ids);
  }, [id]);

  // Re-fetch target status on any scan lifecycle event for this target
  useWsSubscribe(
    ["scan_started", "scan_completed", "scan_error", "scan_paused",
     "scan_resumed", "scan_cancelled"],
    () => void refreshTarget(),
    id,
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    void Promise.all([
      fetch(`/api/v1/targets/${id}`).then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? (r.json() as Promise<Target>) : Promise.reject();
      }),
      fetch(`/api/v1/targets/${id}/pipeline`).then((r) =>
        r.ok ? (r.json() as Promise<PipelineGroup[]>) : Promise.resolve([])
      ),
    ])
      .then(([targetData, pipelineData]) => {
        if (targetData) setTarget(targetData);
        const ids = new Set<string>(
          (pipelineData ?? []).flatMap((g) => g.steps.map((s) => s.step_id))
        );
        setPipelineStepIds(ids);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const visibleTabs = ALL_TABS.filter(({ requiredSteps }) =>
    !requiredSteps || requiredSteps.some((s) => pipelineStepIds.has(s))
  );

  /* ── Not found ── */
  if (!loading && notFound) {
    return (
      <PageTransition>
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium text-foreground">Target not found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No target with ID <code className="font-mono">{id}</code> exists.
            </p>
          </div>
          <button
            onClick={() => navigate("/")}
            className="mt-2 rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to dashboard
          </button>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
    <div className="flex flex-col gap-4 p-3 sm:p-6 max-w-5xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-start gap-3">
        {loading ? (
          <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <span
              className={cn(
                "mt-2 h-2.5 w-2.5 shrink-0 rounded-full",
                STATUS_DOT[target?.status ?? "idle"],
              )}
            />
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Target</p>
                <h1 className="mt-0.5 text-xl font-semibold text-foreground">
                  {target?.domain ?? "—"}
                </h1>
                {target && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {STATUS_LABEL[target.status] ?? target.status} · {target.scan_count} scan
                    {target.scan_count !== 1 ? "s" : ""} · Priority{" "}
                    {target.scan_priority}
                  </p>
                )}
              </div>

              {target && (
                <div className="flex flex-wrap items-center gap-2 sm:pt-1">
                  <button
                    onClick={() => window.open(`/api/v1/targets/${id}/export/report`, "_blank", "noopener")}
                    className="rounded border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Generate Report
                  </button>
                  <ExportMenu targetId={id!} type="diff" />

                  {/* Restart — shown for loop_stopped targets that aren't already queued */}
                  {target.status === "loop_stopped" && !isQueued && (
                    <button
                      onClick={handleRestart}
                      disabled={restarting}
                      className="flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      title="Restart loop scan"
                    >
                      <RotateCcw className={cn("h-3 w-3", restarting && "animate-spin")} />
                      {restarting ? "Queuing…" : "Restart"}
                    </button>
                  )}

                  {/* Edit target */}
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit target"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete — opens confirmation dialog */}
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-colors"
                    title="Delete target"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Tabs */}
      {target && (
        <Tabs.Root key={id} defaultValue="pipeline">
          <div className="overflow-x-auto pb-px -mx-0.5 px-0.5">
            <Tabs.List className="flex gap-1 border-b border-border min-w-max">
              {visibleTabs.map(({ id: tabId, label }) => (
                <Tabs.Trigger
                  key={tabId}
                  value={tabId}
                  className={cn(
                    "px-3 py-2 text-sm transition-colors border-b-2 -mb-px whitespace-nowrap",
                    "text-muted-foreground border-transparent",
                    "data-[state=active]:text-foreground data-[state=active]:border-primary",
                    "hover:text-foreground",
                  )}
                >
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>

          {visibleTabs.map(({ id: tabId, label }) => (
            <Tabs.Content key={tabId} value={tabId} className="pt-4">
              <ErrorBoundary label={label}>
                {tabId === "pipeline" ? (
                  <PipelineFlow
                    targetId={id!}
                    wildcardPolicy={target.wildcard_policy}
                    isQueued={isQueued}
                    queuePosition={id ? queuePositionMap.get(id) : undefined}
                    onDequeued={() => void refreshSchedulerState()}
                  />
                ) : tabId === "config" ? (
                  <TargetConfig
                    targetId={id!}
                    currentTemplate={target.pipeline_template}
                    onTemplateChanged={(tpl) => setTarget((t) => t ? { ...t, pipeline_template: tpl } : t)}
                    onPipelineChanged={() => void refreshPipelineStepIds()}
                  />
                ) : tabId === "subdomains" ? (
                  <SubdomainsTable targetId={id!} />
                ) : tabId === "hosts" ? (
                  <LiveHostsView targetId={id!} />
                ) : tabId === "history" ? (
                  <DiffCompareView targetId={id!} />
                ) : tabId === "ports" ? (
                  <PortsWithChart targetId={id!} />
                ) : tabId === "cloud" ? (
                  <CloudTable targetId={id!} />
                ) : tabId === "takeover" ? (
                  <TakeoverTable targetId={id!} />
                ) : tabId === "scope" ? (
                  <ScopeRuleEditor targetId={id!} />
                ) : tabId === "screenshots" ? (
                  <ScreenshotGallery targetId={id!} />
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {label} — coming in later phases
                  </div>
                )}
              </ErrorBoundary>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      )}
    </div>

    <DeleteConfirmDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      itemName={target?.domain ?? ""}
      itemType="target"
      description="All associated data will be removed — subdomains, ports, live hosts, screenshots, takeover candidates, and scan history."
      onConfirm={handleDelete}
      loading={deleting}
    />

    {target && (
      <EditTargetModal
        target={target}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onUpdated={(updated) => setTarget(updated)}
      />
    )}

    </PageTransition>
  );
}
