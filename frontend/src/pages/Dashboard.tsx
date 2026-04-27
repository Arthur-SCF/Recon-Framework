import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import { AlertCircle, AlertTriangle, Play, Plus, Target, Trash2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/PageTransition";
import { AddTargetWizard } from "@/components/wizard/AddTargetWizard";
import { ImportTargetsDialog } from "@/components/ImportTargetsDialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { StatsRow } from "@/components/dashboard/StatsRow";
import { DashboardCharts } from "@/components/DashboardCharts";
import { TargetCard } from "@/components/dashboard/TargetCard";
import { ScanQueueWidget } from "@/components/dashboard/ScanQueueWidget";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { SkeletonCards } from "@/components/Skeleton";
import { useSchedulerState, buildQueuePositionMap } from "@/hooks/useSchedulerState";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { Target as TargetType, ToolHealth } from "@/types/api";

export function Dashboard() {
  const [targets, setTargets]     = useState<TargetType[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [addOpen, setAddOpen]       = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selected, setSelected]   = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [outdatedTools, setOutdatedTools] = useState(0);
  const navigate = useNavigate();
  const { actionFetch } = useActionFetch();
  const { state: schedState } = useSchedulerState();
  const queuePositionMap = useMemo(
    () => buildQueuePositionMap(schedState),
    [schedState],
  );

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/targets");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTargets((await res.json()) as TargetType[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load targets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchTargets();
    const interval = setInterval(() => void fetchTargets(), 30_000);
    return () => clearInterval(interval);
  }, [fetchTargets]);

  // Refresh immediately on any scan lifecycle event (no targetId filter = all targets)
  useWsSubscribe(
    ["scan_started", "scan_completed", "scan_error", "scan_paused", "scan_resumed", "scan_cancelled"],
    () => void fetchTargets(),
  );

  useEffect(() => {
    fetch("/api/v1/targets/tags")
      .then((r) => r.ok ? r.json() as Promise<{ tag: string; count: number }[]> : [])
      .then(setAllTags)
      .catch(() => {});
  }, [targets]); // refresh tag list when targets change

  useEffect(() => {
    fetch("/api/v1/settings/tools-updates")
      .then((r) => r.ok ? r.json() as Promise<ToolHealth[]> : [])
      .then((tools) => setOutdatedTools(tools.filter((t) => t.update_available).length))
      .catch(() => {});
  }, []);

  const filteredTargets = useMemo(
    () => activeTag ? targets.filter((t) => t.tags?.includes(activeTag)) : targets,
    [targets, activeTag],
  );

  function handleCreated(target: TargetType) {
    setTargets((prev) => [target, ...prev]);
  }

  function handleDeleted(id: string) {
    setTargets((prev) => prev.filter((t) => t.id !== id));
    setSelected((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function selectAll() {
    const visibleIds = filteredTargets.map((t) => t.id);
    const allVisibleSelected = visibleIds.every((id) => selected.has(id));
    if (allVisibleSelected) {
      setSelected((prev) => {
        const s = new Set(prev);
        visibleIds.forEach((id) => s.delete(id));
        return s;
      });
    } else {
      setSelected((prev) => new Set([...prev, ...visibleIds]));
    }
  }

  async function bulkDelete() {
    if (!selected.size) return;
    setBulkLoading(true);
    const res = await actionFetch("/api/v1/targets/bulk/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
      successMessage: `${selected.size} target${selected.size !== 1 ? "s" : ""} deleted`,
      errorPrefix: "Bulk delete",
    });
    setBulkLoading(false);
    if (!res) return;
    setTargets((prev) => prev.filter((t) => !selected.has(t.id)));
    setSelected(new Set());
  }

  async function bulkStart() {
    if (!selected.size) return;
    setBulkLoading(true);
    const res = await actionFetch("/api/v1/targets/bulk/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
      successMessage: `${selected.size} scan${selected.size !== 1 ? "s" : ""} queued`,
      errorPrefix: "Bulk start",
    });
    setBulkLoading(false);
    if (!res) return;
    setSelected(new Set());
    void fetchTargets();
  }

  const selCount = selected.size;
  const allSelected =
    filteredTargets.length > 0 &&
    filteredTargets.every((t) => selected.has(t.id));

  return (
    <PageTransition>
    <div className="flex flex-col gap-5 p-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {targets.length > 0
              ? `${targets.length} target${targets.length !== 1 ? "s" : ""}`
              : "Manage your recon targets"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Import
          </button>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Target
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && targets.length === 0 && (
        <div className="flex flex-col gap-5">
          <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
          <SkeletonCards count={6} />
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && targets.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
          <Target className="h-10 w-10 text-muted-foreground/30" />
          <p className="mt-4 text-sm font-medium text-muted-foreground">
            No targets yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground/60">
            Add your first target to start scanning.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="mt-6 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Target
          </button>
        </div>
      )}

      {/* Stats + Content */}
      {targets.length > 0 && (
        <>
          {/* Stats row */}
          <StatsRow targets={targets} />

          {/* Analytics charts */}
          <DashboardCharts />

          {/* Tool update warning */}
          {outdatedTools > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-400 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {outdatedTools} tool update{outdatedTools > 1 ? "s" : ""} available —{" "}
              <a href="/settings#tools" className="underline underline-offset-2 hover:text-amber-300">
                View in Settings
              </a>
            </div>
          )}

          {/* Scan queue + Activity feed */}
          <div className="grid gap-3 lg:grid-cols-3">
            <ScanQueueWidget />
            <div className="lg:col-span-2">
              <ActivityFeed />
            </div>
          </div>

          {/* Tag filter bar */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setActiveTag(null)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  activeTag === null
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                All
              </button>
              {allTags.map(({ tag, count }) => (
                <button
                  key={tag}
                  onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                    activeTag === tag
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  #{tag}
                  <span className="ml-1 opacity-60">{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Target grid */}
          <div>
            <div className="mb-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selCount > 0 && !allSelected;
                }}
                onChange={selectAll}
                className="h-3.5 w-3.5 cursor-pointer rounded"
                title={allSelected ? "Deselect all" : "Select all"}
              />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                {activeTag ? `#${activeTag}` : "Targets"}
                {activeTag && (
                  <span className="ml-1.5 font-normal normal-case">
                    ({filteredTargets.length})
                  </span>
                )}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredTargets.map((t, i) => (
                <div key={t.id} className="relative group/selectable">
                  {/* Selection overlay */}
                  <button
                    onClick={(e) => toggleSelect(t.id, e)}
                    className={cn(
                      "absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded",
                      "border border-border bg-card transition-opacity",
                      selected.has(t.id)
                        ? "opacity-100 border-primary bg-primary"
                        : "opacity-0 group-hover/selectable:opacity-100",
                    )}
                    title="Select target"
                  >
                    {selected.has(t.id) && (
                      <svg className="h-3 w-3 text-primary-foreground" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>

                  <TargetCard
                    target={t}
                    index={i}
                    queuePosition={queuePositionMap.get(t.id)}
                    onRestart={async () => {
                      const res = await actionFetch(`/api/v1/targets/${t.id}/start`, {
                        method: "POST",
                        errorPrefix: "Start scan",
                      });
                      if (!res) return;
                      void fetchTargets();
                    }}
                    onClick={() => {
                      if (selCount > 0) {
                        // In selection mode — toggle instead of navigate
                        setSelected((prev) => {
                          const s = new Set(prev);
                          s.has(t.id) ? s.delete(t.id) : s.add(t.id);
                          return s;
                        });
                      } else {
                        navigate(`/target/${t.id}`);
                      }
                    }}
                    onDelete={async () => {
                      const res = await actionFetch(`/api/v1/targets/${t.id}`, {
                        method: "DELETE",
                        errorPrefix: "Delete target",
                      });
                      if (!res) return;
                      handleDeleted(t.id);
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <AddTargetWizard
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={handleCreated}
      />
      <ImportTargetsDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void fetchTargets()}
      />
    </div>

    <DeleteConfirmDialog
      open={bulkDeleteOpen}
      onOpenChange={setBulkDeleteOpen}
      itemName={`${selCount} target${selCount !== 1 ? "s" : ""}`}
      itemType="targets"
      description="All associated data (subdomains, hosts, ports, screenshots) will also be removed."
      onConfirm={async () => { await bulkDelete(); setBulkDeleteOpen(false); }}
      loading={bulkLoading}
    />

    {/* Floating bulk action bar */}
    {selCount > 0 && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-xl">
        <span className="text-sm font-medium text-foreground">
          {selCount} selected
        </span>
        <div className="h-4 w-px bg-border" />
        <button
          onClick={() => void bulkStart()}
          disabled={bulkLoading}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          <Play className="h-3.5 w-3.5" />
          Start Scan
        </button>
        <button
          onClick={() => setBulkDeleteOpen(true)}
          disabled={bulkLoading}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
        <button
          onClick={() => setSelected(new Set())}
          className="rounded-full p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Deselect all"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )}
    </PageTransition>
  );
}
