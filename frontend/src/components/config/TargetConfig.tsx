import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, Plus, RefreshCw, Trash2, ChevronDown, Clock,
  Network, Zap, Globe, Server, Cpu, Code2,
  AlertTriangle, Camera, Cloud, Shield, Box, Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineGroup, PipelineTemplate } from "@/types/api";
import { Switch } from "@/components/ui/switch";
import { StepConfigRow } from "./StepConfigRow";
import { MutexStepGroup } from "./MutexStepGroup";
import { STEP_DEPS } from "./stepDependencies";
import { PRESETS, type PresetName } from "./presets";
import { useConfigShortcuts } from "@/hooks/useConfigShortcuts";
import { useActionFetch } from "@/hooks/useActionFetch";

// ── Mutex pair ────────────────────────────────────────────────────────────────
const MUTEX_PAIR = new Set(["zgrab2_service", "nmap_service"]);

// ── Category icons (no color — accent/bar color is semantic, not categorical) ─
type CategoryId =
  | "passive" | "dns" | "action" | "http" | "ports"
  | "service" | "js" | "takeover" | "screenshots"
  | "cloud" | "waf" | "other";

const CATEGORY_ICONS: Record<CategoryId, React.ComponentType<{ className?: string }>> = {
  passive:     Radio,
  dns:         Network,
  action:      Zap,
  http:        Globe,
  ports:       Server,
  service:     Cpu,
  js:          Code2,
  takeover:    AlertTriangle,
  screenshots: Camera,
  cloud:       Cloud,
  waf:         Shield,
  other:       Box,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getGroupCategory(
  group: PipelineGroup,
  stepMeta: Record<string, { category: string }>,
): CategoryId {
  for (const step of group.steps) {
    if (!step.skippable) continue;
    const cat = stepMeta[step.step_id]?.category as CategoryId | undefined;
    if (cat && cat !== "action" && cat in CATEGORY_ICONS) return cat;
  }
  return "action";
}

function getBarClass(groupEnabled: boolean, enabledCount: number): string {
  if (!groupEnabled || enabledCount === 0) return "bg-border/60";
  return "bg-primary";
}

function fmtSeconds(s: number): string {
  if (s <= 0) return "";
  if (s < 60)  return `~${s}s`;
  if (s < 3600) return `~${Math.round(s / 60)}m`;
  return `~${Math.round(s / 3600 * 10) / 10}h`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  targetId: string;
  currentTemplate?: string;
  onTemplateChanged?: (templateName: string) => void;
}

export function TargetConfig({ targetId, currentTemplate = "standard", onTemplateChanged }: Props) {
  const { actionFetch } = useActionFetch();
  const [groups,       setGroups]       = useState<PipelineGroup[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [templates,    setTemplates]    = useState<PipelineTemplate[]>([]);
  const [stepMeta,     setStepMeta]     = useState<Record<string, { label: string; category: string }>>({});
  const [selected,     setSelected]     = useState(currentTemplate);
  const [applying,     setApplying]     = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [addGroupOpen,  setAddGroupOpen]  = useState(false);
  const [newGroupName,  setNewGroupName]  = useState("");
  const [newGroupParallel, setNewGroupParallel] = useState(false);
  const [addingGroup,  setAddingGroup]  = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [etaByGroup, setEtaByGroup] = useState<Record<string, number>>({});
  const [applyingPreset,  setApplyingPreset]  = useState<PresetName | null>(null);
  const [resettingParams, setResettingParams] = useState(false);
  const [pauseOnFailure,  setPauseOnFailure]  = useState(false);

  // Expand/collapse state — all open on first load
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const initialExpanded = useRef(false);

  useEffect(() => { setSelected(currentTemplate); }, [currentTemplate]);

  const fetchPipeline = useCallback(async () => {
    const res = await fetch(`/api/v1/targets/${targetId}/pipeline`);
    if (res.ok) {
      const data = (await res.json()) as PipelineGroup[];
      setGroups(data);
      if (!initialExpanded.current) {
        setOpenGroups(new Set(data.map(g => g.id)));
        initialExpanded.current = true;
      }
    }
    setLoading(false);
    // Fire ETA fetch in background — don't block render
    void fetch(`/api/v1/targets/${targetId}/pipeline/eta`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.per_group) setEtaByGroup(data.per_group as Record<string, number>);
      })
      .catch(() => {/* non-critical */});
  }, [targetId]);

  useEffect(() => { void fetchPipeline(); }, [fetchPipeline]);

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/pipeline/templates").then(r => r.ok ? r.json() : []),
      fetch("/api/v1/pipeline/steps").then(r => r.ok ? r.json() : []),
    ]).then(([tpls, steps]) => {
      setTemplates(tpls as PipelineTemplate[]);
      const meta: Record<string, { label: string; category: string }> = {};
      for (const s of steps as Array<{ step_id: string; label: string; category: string }>) {
        meta[s.step_id] = { label: s.label, category: s.category };
      }
      setStepMeta(meta);
    });
  }, []);

  useEffect(() => {
    void fetch(`/api/v1/targets/${targetId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data: { pause_on_failure?: boolean } | null) => {
        if (data) setPauseOnFailure(data.pause_on_failure ?? false);
      });
  }, [targetId]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const enabledStepIds = new Set(
    groups.flatMap(g => g.steps.filter(s => s.enabled).map(s => s.step_id))
  );

  function getDepWarning(stepId: string): string | undefined {
    const deps = STEP_DEPS[stepId];
    if (!deps || deps.length === 0) return undefined;
    if (deps.some(d => enabledStepIds.has(d))) return undefined;
    return `Requires: ${deps.join(" or ")} (currently disabled)`;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async function applyTemplate() {
    setApplying(true);
    setResetConfirm(false);
    try {
      const body = selected !== currentTemplate ? { template_name: selected } : {};
      const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        successMessage: "Pipeline template applied",
        errorPrefix: "Apply template failed",
      });
      if (!res) return;
      onTemplateChanged?.(selected);
      initialExpanded.current = false;
      setTemplatePickerOpen(false);
      await fetchPipeline();
    } finally {
      setApplying(false);
    }
  }

  async function resetParams() {
    setResettingParams(true);
    try {
      const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/reset-params`, {
        method: "POST",
        successMessage: "Parameters reset to template defaults",
        errorPrefix: "Reset params failed",
      });
      if (!res) return;
      await fetchPipeline();
    } finally {
      setResettingParams(false);
    }
  }

  async function handleGroupUpdate(groupId: string, patch: { enabled?: boolean; parallel?: boolean }) {
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...patch } : g));
    await actionFetch(`/api/v1/targets/${targetId}/pipeline/groups/${groupId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
      errorPrefix: "Update group failed",
    });
  }

  async function handleDeleteGroup(groupId: string) {
    setDeleteGroupId(null);
    const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/groups/${groupId}`, {
      method: "DELETE",
      successMessage: "Group deleted",
      errorPrefix: "Delete group failed",
    });
    if (!res) return;
    await fetchPipeline();
  }

  async function handleAddGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    setAddingGroup(true);
    try {
      const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parallel: newGroupParallel }),
        successMessage: "Group added",
        errorPrefix: "Add group failed",
      });
      if (!res) return;
      setNewGroupName("");
      setNewGroupParallel(false);
      setAddGroupOpen(false);
      await fetchPipeline();
    } finally {
      setAddingGroup(false);
    }
  }

  function toggleGroup(groupId: string) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  useConfigShortcuts({
    onExpandAll:   () => setOpenGroups(new Set(groups.map(g => g.id))),
    onCollapseAll: () => setOpenGroups(new Set()),
  });

  async function handlePauseOnFailureToggle(value: boolean) {
    setPauseOnFailure(value);
    await actionFetch(`/api/v1/targets/${targetId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pause_on_failure: value }),
      errorPrefix: "Update pause-on-failure failed",
    });
  }

  async function applyPreset(name: PresetName) {
    const preset = PRESETS.find(p => p.name === name);
    if (!preset || applyingPreset) return;
    setApplyingPreset(name);
    try {
      // Build a flat map of step_row_id → desired enabled state
      const stepMap: Record<string, boolean> = {};
      for (const group of groups) {
        for (const step of group.steps) {
          if (step.step_id in preset.overrides) {
            stepMap[step.id] = preset.overrides[step.step_id];
          }
        }
      }
      // Only PUT steps that actually change
      const currentEnabled = new Set(
        groups.flatMap(g => g.steps.filter(s => s.enabled).map(s => s.id))
      );
      const changed = Object.entries(stepMap).filter(([id, en]) =>
        en !== currentEnabled.has(id)
      );
      const results = await Promise.all(changed.map(([id, enabled]) =>
        actionFetch(`/api/v1/targets/${targetId}/pipeline/steps/${id}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ enabled }),
          errorPrefix: "Apply preset failed",
        })
      ));
      if (results.some(r => r === null)) return;
      await fetchPipeline();
    } finally {
      setApplyingPreset(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isDirty = selected !== currentTemplate;
  const currentTemplateName = templates.find(t => t.name === currentTemplate)?.display_name ?? currentTemplate;

  const activeGroupCount = groups.filter(g =>
    g.enabled && g.steps.some(s => s.skippable && s.enabled)
  ).length;
  const totalEnabled = groups.reduce((n, g) => n + g.steps.filter(s => s.skippable && s.enabled).length, 0);
  const totalSkippable = groups.reduce((n, g) => n + g.steps.filter(s => s.skippable).length, 0);

  // Health summary
  const depWarningCount = groups.reduce((n, g) => {
    return n + g.steps.filter(s => s.enabled && !!getDepWarning(s.step_id)).length;
  }, 0);
  const modifiedCount = groups.reduce((n, g) => {
    return n + g.steps.filter(s => s.skippable && Object.keys(s.config_overrides ?? {}).length > 0).length;
  }, 0);

  return (
    <div className="flex flex-col gap-3">

      {/* ── Template picker — collapsed by default ── */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        {/* Always-visible summary row */}
        <button
          onClick={() => { setTemplatePickerOpen(v => !v); setResetConfirm(false); }}
          className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors text-left"
        >
          <span className="text-xs text-muted-foreground shrink-0">Template</span>
          <span className="flex-1 text-xs font-medium text-foreground truncate">{currentTemplateName}</span>
          {isDirty && (
            <span className="text-[10px] text-amber-500 shrink-0">unsaved</span>
          )}
          <ChevronDown className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 shrink-0",
            !templatePickerOpen && "-rotate-90"
          )} />
        </button>

        {/* Expanded picker */}
        <AnimatePresence initial={false}>
          {templatePickerOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <div className="px-4 pb-3 pt-1 border-t border-border/50 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <select
                    value={selected}
                    onChange={(e) => { setSelected(e.target.value); setResetConfirm(false); }}
                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.name}>{t.display_name}</option>
                    ))}
                  </select>

                  {!resetConfirm && (
                    <>
                      {isDirty && (
                        <button
                          onClick={() => setResetConfirm(true)}
                          className="rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors shrink-0"
                        >
                          Apply
                        </button>
                      )}
                      <button
                        onClick={() => setResetConfirm(true)}
                        title="Reset all params to template defaults"
                        className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Reset params — preserves group structure, wipes overrides */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => void resetParams()}
                    disabled={resettingParams}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title="Clear all parameter overrides and restore template defaults"
                  >
                    {resettingParams
                      ? <Loader2 className="h-2.5 w-2.5 animate-spin inline mr-0.5" />
                      : null}
                    Reset params
                  </button>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground/60">preserves group structure</span>
                </div>

                {resetConfirm && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      {isDirty ? "Overwrites current pipeline —" : "Reset all params to template defaults —"}
                    </span>
                    <button
                      onClick={() => void applyTemplate()}
                      disabled={applying}
                      className="flex items-center gap-1 rounded border border-destructive/50 bg-background px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      {applying && <Loader2 className="h-3 w-3 animate-spin" />}
                      Confirm
                    </button>
                    <button
                      onClick={() => { setResetConfirm(false); if (!isDirty) setSelected(currentTemplate); }}
                      className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Pause on failure ── */}
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-foreground">Pause on Step Failure</p>
          <p className="text-xs text-muted-foreground">
            Auto-pause after a step exhausts all retries. Enables Telegram action buttons.
          </p>
        </div>
        <button
          onClick={() => void handlePauseOnFailureToggle(!pauseOnFailure)}
          className={cn(
            "relative h-6 w-11 rounded-full transition-colors",
            pauseOnFailure ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full toggle-thumb transition-transform",
              pauseOnFailure && "translate-x-5",
            )}
          />
        </button>
      </div>

      {/* ── Health summary ── */}
      {groups.length > 0 && (
        <div className="flex items-center gap-3 px-1 flex-wrap">
          <span className={cn(
            "text-[11px] tabular-nums",
            totalEnabled === 0 ? "text-muted-foreground/40" : "text-foreground"
          )}>
            <span className="font-medium">{totalEnabled}</span>
            <span className="text-muted-foreground">/{totalSkippable} steps enabled</span>
          </span>

          {modifiedCount > 0 && (
            <span className="text-[11px] text-primary/70 tabular-nums">
              ◆ {modifiedCount} modified
            </span>
          )}

          {depWarningCount > 0 && (
            <span className="text-[11px] text-amber-500 tabular-nums">
              ⚠ {depWarningCount} dep {depWarningCount === 1 ? "issue" : "issues"}
            </span>
          )}

          {depWarningCount === 0 && totalEnabled > 0 && (
            <span className="text-[11px] text-green-500/70">✓ dependencies OK</span>
          )}
        </div>
      )}

      {/* ── Pipeline overview bar ── */}
      {groups.length > 0 && (
        <div className="rounded-lg border border-border bg-card px-4 py-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-foreground">Pipeline</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {activeGroupCount}/{groups.length} active · {totalEnabled}/{totalSkippable} steps on
            </span>
          </div>
          <div className="flex gap-0.5 h-2.5">
            {groups.map((group) => {
              const skippable = group.steps.filter(s => s.skippable);
              const enabled = skippable.filter(s => s.enabled).length;
              return (
                <button
                  key={group.id}
                  onClick={() => {
                    document.getElementById(`group-${group.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    if (!openGroups.has(group.id)) toggleGroup(group.id);
                  }}
                  title={`${group.name}: ${enabled}/${skippable.length} steps enabled`}
                  className={cn(
                    "flex-1 rounded-sm transition-colors hover:opacity-70",
                    getBarClass(group.enabled, enabled)
                  )}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Preset chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-muted-foreground shrink-0">Quick&nbsp;profile:</span>
        {PRESETS.map(preset => (
          <button
            key={preset.name}
            disabled={!!applyingPreset}
            onClick={() => void applyPreset(preset.name)}
            title={preset.description}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] border transition-colors",
              applyingPreset === preset.name
                ? "border-primary bg-primary/20 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
              "disabled:opacity-50"
            )}
          >
            {applyingPreset === preset.name && (
              <Loader2 className="h-2.5 w-2.5 animate-spin inline mr-1" />
            )}
            {preset.label}
          </button>
        ))}
      </div>

      {/* ── Groups ── */}
      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const skippable = group.steps.filter(s => s.skippable);
          const enabledCount = skippable.filter(s => s.enabled).length;
          const totalCount = skippable.length;
          const cat = getGroupCategory(group, stepMeta);
          const CatIcon = CATEGORY_ICONS[cat];
          const isOpen = openGroups.has(group.id);
          const isDeletePending = deleteGroupId === group.id;
          const mutexSteps = group.steps.filter(s => MUTEX_PAIR.has(s.step_id));
          const showMutex = mutexSteps.length === 2;
          const regularSteps = group.steps.filter(s =>
            showMutex ? !MUTEX_PAIR.has(s.step_id) : true
          );
          const mutexDepWarning = showMutex && mutexSteps.every(s => !enabledStepIds.has(s.step_id))
            ? getDepWarning("zgrab2_service")
            : undefined;

          // Is group active (for icon tint)
          const isActive = group.enabled && enabledCount > 0;

          return (
            <div
              key={group.id}
              id={`group-${group.id}`}
              className="group/card rounded-lg border border-border bg-card overflow-hidden shadow-sm"
            >
              {/* Group header — full row click to toggle, controls stop propagation */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none transition-colors duration-150",
                  isActive && "bg-primary/5"
                )}
                onClick={() => toggleGroup(group.id)}
              >
                {/* Status dot — green=active, amber=enabled/idle, muted=disabled */}
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0 transition-colors",
                  group.enabled && enabledCount > 0
                    ? "bg-green-500"
                    : group.enabled
                      ? "bg-amber-500/50"
                      : "bg-muted-foreground/25"
                )} />

                <ChevronDown className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  !isOpen && "-rotate-90"
                )} />

                {/* Category icon — primary tint when active, muted when not */}
                <CatIcon className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-colors",
                  isActive ? "text-primary/70" : "text-muted-foreground/40"
                )} />

                {/* Group name */}
                <span className={cn(
                  "flex-1 text-xs font-medium truncate min-w-0 transition-colors",
                  group.enabled ? "text-foreground" : "text-muted-foreground/60"
                )}>
                  {group.name}
                </span>

                {/* Step count */}
                {totalCount > 0 && (
                  <span className={cn(
                    "text-[10px] tabular-nums font-medium shrink-0",
                    enabledCount === totalCount
                      ? "text-muted-foreground/60"
                      : enabledCount === 0
                        ? "text-muted-foreground/30"
                        : "text-amber-500"
                  )}>
                    {enabledCount}/{totalCount}
                  </span>
                )}

                {/* ETA badge */}
                {group.enabled && enabledCount > 0 && etaByGroup[group.id] ? (
                  <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">
                    <Clock className="h-2.5 w-2.5" />
                    {fmtSeconds(etaByGroup[group.id])}
                  </span>
                ) : null}

                {/* Interactive controls — stop propagation so they don't toggle expand */}
                <div
                  className="flex items-center gap-1.5 shrink-0"
                  onClick={e => e.stopPropagation()}
                >
                  {/* Master enable/disable */}
                  <Switch
                    checked={group.enabled}
                    onCheckedChange={(v) => void handleGroupUpdate(group.id, { enabled: v })}
                  />

                  {/* Delete — hover-only */}
                  {isDeletePending ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">Delete?</span>
                      <button
                        onClick={() => void handleDeleteGroup(group.id)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-destructive border border-destructive/40 hover:bg-destructive/10 transition-colors"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setDeleteGroupId(null)}
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground border border-border hover:text-foreground transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteGroupId(group.id)}
                      className="text-muted-foreground/0 group-hover/card:text-muted-foreground/40 hover:!text-destructive transition-colors"
                      title="Delete group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Steps + execution mode — animated expand/collapse */}
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="steps"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className={cn(!group.enabled && "pointer-events-none opacity-50")}>
                      {/* Execution mode — inside body so header stays lean */}
                      {totalCount > 0 && (
                        <div className="flex items-center gap-2 px-4 py-1.5 border-t border-border/50 bg-muted/20">
                          <span className="text-[10px] text-muted-foreground">Execution</span>
                          <div className="flex rounded border border-border overflow-hidden text-[10px]">
                            <button
                              onClick={() => void handleGroupUpdate(group.id, { parallel: false })}
                              className={cn(
                                "px-2 py-0.5 transition-colors",
                                !group.parallel ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                              )}
                              title="Run steps one after another"
                            >
                              Sequential
                            </button>
                            <button
                              onClick={() => void handleGroupUpdate(group.id, { parallel: true })}
                              className={cn(
                                "px-2 py-0.5 border-l border-border transition-colors",
                                group.parallel ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                              )}
                              title="Run all steps at the same time"
                            >
                              Parallel
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Step rows */}
                      <div className="divide-y divide-border/50 border-t border-border/50">
                        {regularSteps.length === 0 && !showMutex ? (
                          <div className="px-4 py-3 text-[11px] text-muted-foreground/50 italic">
                            No steps — reset to template to repopulate
                          </div>
                        ) : (
                          <>
                            {regularSteps.map((step) => (
                              <StepConfigRow
                                key={step.id}
                                targetId={targetId}
                                step={step}
                                label={stepMeta[step.step_id]?.label}
                                onUpdated={fetchPipeline}
                                depWarning={getDepWarning(step.step_id)}
                              />
                            ))}
                            {showMutex && (
                              <MutexStepGroup
                                steps={mutexSteps}
                                stepLabels={Object.fromEntries(
                                  mutexSteps.map(s => [s.step_id, stepMeta[s.step_id]?.label ?? s.step_id])
                                )}
                                targetId={targetId}
                                onUpdated={fetchPipeline}
                                depWarning={mutexDepWarning}
                              />
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {/* ── Add group ── */}
      <div className="rounded-lg border border-border border-dashed bg-card/50">
        {addGroupOpen ? (
          <div className="px-4 py-3 flex flex-col gap-2">
            <p className="text-xs font-medium text-foreground">New Group</p>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddGroup();
                if (e.key === "Escape") setAddGroupOpen(false);
              }}
              placeholder="Group name…"
              autoFocus
              className="rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={newGroupParallel}
                onChange={(e) => setNewGroupParallel(e.target.checked)}
                className="accent-primary"
              />
              Run steps in parallel
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => void handleAddGroup()}
                disabled={!newGroupName.trim() || addingGroup}
                className="flex items-center gap-1 rounded border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
              >
                {addingGroup && <Loader2 className="h-3 w-3 animate-spin" />}
                Add Group
              </button>
              <button
                onClick={() => { setAddGroupOpen(false); setNewGroupName(""); setNewGroupParallel(false); }}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddGroupOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Group
          </button>
        )}
      </div>
    </div>
  );
}
