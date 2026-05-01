import { useEffect, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2, RefreshCw, Trash2, ChevronDown, Clock, Lock, Settings2,
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

// ── Category icons ─────────────────────────────────────────────────────────────
type CategoryId =
  | "passive" | "dns" | "action" | "http" | "ports"
  | "service" | "js" | "takeover" | "screenshots"
  | "cloud" | "waf" | "other";

// Icon + phase label + phase line tint + card border per category
const CATEGORY_THEME: Record<CategoryId, { icon: string; phaseText: string; phaseLine: string; cardAccentL: string; hex: string }> = {
  passive:     { icon: "text-blue-400",    phaseText: "text-blue-400/60",    phaseLine: "bg-blue-400/10",    cardAccentL: "border-l-blue-400/55",    hex: "#54a2ff" },
  dns:         { icon: "text-cyan-400",    phaseText: "text-cyan-400/60",    phaseLine: "bg-cyan-400/10",    cardAccentL: "border-l-cyan-400/55",    hex: "#00d2ef" },
  http:        { icon: "text-emerald-400", phaseText: "text-emerald-400/60", phaseLine: "bg-emerald-400/10", cardAccentL: "border-l-emerald-400/55", hex: "#00d294" },
  ports:       { icon: "text-orange-400",  phaseText: "text-orange-400/60",  phaseLine: "bg-orange-400/10",  cardAccentL: "border-l-orange-400/55",  hex: "#ff8b1a" },
  service:     { icon: "text-violet-400",  phaseText: "text-violet-400/60",  phaseLine: "bg-violet-400/10",  cardAccentL: "border-l-violet-400/55",  hex: "#a685ff" },
  js:          { icon: "text-yellow-400",  phaseText: "text-yellow-400/60",  phaseLine: "bg-yellow-400/10",  cardAccentL: "border-l-yellow-400/55",  hex: "#fac800" },
  takeover:    { icon: "text-red-400",     phaseText: "text-red-400/60",     phaseLine: "bg-red-400/10",     cardAccentL: "border-l-red-400/55",     hex: "#ff6568" },
  screenshots: { icon: "text-pink-400",    phaseText: "text-pink-400/60",    phaseLine: "bg-pink-400/10",    cardAccentL: "border-l-pink-400/55",    hex: "#fb64b6" },
  cloud:       { icon: "text-sky-400",     phaseText: "text-sky-400/60",     phaseLine: "bg-sky-400/10",     cardAccentL: "border-l-sky-400/55",     hex: "#00bcfe" },
  waf:         { icon: "text-amber-400",   phaseText: "text-amber-400/60",   phaseLine: "bg-amber-400/10",   cardAccentL: "border-l-amber-400/55",   hex: "#fcbb00" },
  action:      { icon: "text-zinc-500",    phaseText: "text-muted-foreground/40", phaseLine: "bg-border/25", cardAccentL: "border-l-border/40",      hex: "#71717b" },
  other:       { icon: "text-zinc-500",    phaseText: "text-muted-foreground/40", phaseLine: "bg-border/25", cardAccentL: "border-l-border/40",      hex: "#71717b" },
};

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

// ── Phase labels — shown as section dividers when category changes ────────────
const PHASE_LABELS: Partial<Record<CategoryId, string>> = {
  passive:     "Discovery",
  dns:         "DNS",
  http:        "HTTP",
  ports:       "Ports",
  service:     "Services",
  js:          "Content",
  cloud:       "Cloud",
  waf:         "WAF",
  takeover:    "Takeover",
  screenshots: "Screenshots",
  // "action" and "other" intentionally omitted — internal steps, no label
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
  const [applyConfirm,       setApplyConfirm]       = useState(false);
  const [resetParamsConfirm, setResetParamsConfirm] = useState(false);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [etaByGroup,   setEtaByGroup]   = useState<Record<string, number>>({});
  const [applyingPreset,  setApplyingPreset]  = useState<PresetName | null>(null);
  const [resettingParams, setResettingParams] = useState(false);
  const [pauseOnFailure,  setPauseOnFailure]  = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");
  const [savingTemplate,   setSavingTemplate]   = useState(false);

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
    setApplyConfirm(false);
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
      setSettingsOpen(false);
      await fetchPipeline();
    } finally {
      setApplying(false);
    }
  }

  async function resetParams() {
    setResettingParams(true);
    setResetParamsConfirm(false);
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
      const stepMap: Record<string, boolean> = {};
      for (const group of groups) {
        for (const step of group.steps) {
          if (step.step_id in preset.overrides) {
            stepMap[step.id] = preset.overrides[step.step_id];
          }
        }
      }
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

  async function handleSaveTemplate() {
    const name = saveTemplateName.trim();
    if (!name) return;
    setSavingTemplate(true);
    try {
      const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/save-as-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        successMessage: `Saved as "${name}"`,
        errorPrefix: "Save template failed",
      });
      if (!res) return;
      setSaveTemplateName("");
    } finally {
      setSavingTemplate(false);
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

  // activeGroupCount: locked-only groups always count as active
  const activeGroupCount = groups.filter(g =>
    g.enabled && (
      g.steps.some(s => s.skippable && s.enabled) ||
      g.steps.some(s => !s.skippable)
    )
  ).length;
  const totalEnabled   = groups.reduce((n, g) => n + g.steps.filter(s => s.skippable && s.enabled).length, 0);
  const totalSkippable = groups.reduce((n, g) => n + g.steps.filter(s => s.skippable).length, 0);

  const depWarningCount = groups.reduce((n, g) =>
    n + g.steps.filter(s => s.enabled && !!getDepWarning(s.step_id)).length, 0);
  const modifiedCount = groups.reduce((n, g) =>
    n + g.steps.filter(s => s.skippable && Object.keys(s.config_overrides ?? {}).length > 0).length, 0);

  return (
    <div className="flex flex-col gap-3">

      {/* ── Pipeline overview card + collapsible settings ── */}
      <div className="rounded-2xl bg-card/90 backdrop-blur-xl border border-white/[0.07] shadow-lg shadow-black/20 overflow-hidden">

        {/* Primary accent bar */}
        <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/50 to-transparent shrink-0" />

        {/* Header: stats always visible, gear opens settings */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary/[0.05] to-transparent">
          <span className="text-xs font-medium text-foreground">Pipeline</span>
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {activeGroupCount}/{groups.length} active · {totalEnabled}/{totalSkippable} steps
            </span>
            {modifiedCount > 0 && (
              <span className="text-[10px] text-primary/70 tabular-nums">◆ {modifiedCount}</span>
            )}
            {depWarningCount > 0 && (
              <span className="text-[10px] text-amber-500 tabular-nums">⚠ {depWarningCount}</span>
            )}
            {depWarningCount === 0 && totalEnabled > 0 && (
              <span className="text-[10px] text-green-500/70">✓</span>
            )}
            <button
              onClick={() => {
                setSettingsOpen(v => !v);
                setApplyConfirm(false);
                setResetParamsConfirm(false);
              }}
              title="Pipeline settings"
              className={cn(
                "rounded p-1 transition-colors",
                settingsOpen
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Mini bar — clickable segments scroll to group (desktop only) */}
        {groups.length > 0 && (
          <div className="hidden sm:flex gap-0.5 h-1.5 px-4 pb-2.5">
            {groups.map((group) => {
              const skippable  = group.steps.filter(s => s.skippable);
              const enabled    = skippable.filter(s => s.enabled).length;
              const lockedOnly = skippable.length === 0 && group.steps.some(s => !s.skippable);
              return (
                <button
                  key={group.id}
                  onClick={() => {
                    document.getElementById(`group-${group.id}`)
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    if (!openGroups.has(group.id)) toggleGroup(group.id);
                  }}
                  title={
                    lockedOnly
                      ? `${group.name}: always runs (mandatory)`
                      : `${group.name}: ${enabled}/${skippable.length} steps enabled`
                  }
                  className={cn(
                    "flex-1 rounded-sm transition-colors hover:opacity-70",
                    lockedOnly && group.enabled
                      ? "bg-primary/35"
                      : getBarClass(group.enabled, enabled)
                  )}
                />
              );
            })}
          </div>
        )}

        {/* Settings panel: template, pause, presets, save-as-template */}
        <AnimatePresence initial={false}>
          {settingsOpen && (
            <motion.div
              key="settings"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
            >
              <div className="border-t border-white/[0.06] px-4 py-3 flex flex-col gap-4">

                {/* Template */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Template</span>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <select
                        value={selected}
                        onChange={(e) => { setSelected(e.target.value); setApplyConfirm(false); }}
                        className="w-full appearance-none rounded border border-border bg-background pl-2 pr-7 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        {templates.map((t) => (
                          <option key={t.id} value={t.name}>{t.display_name}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    {isDirty && !applyConfirm && (
                      <button
                        onClick={() => setApplyConfirm(true)}
                        className="rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground hover:border-primary/50 transition-colors shrink-0"
                      >
                        Apply
                      </button>
                    )}
                    <button
                      onClick={() => setResetParamsConfirm(v => !v)}
                      title="Reset all params to template defaults"
                      className={cn(
                        "rounded border border-border bg-background p-1.5 transition-colors shrink-0",
                        resetParamsConfirm ? "border-primary/50 text-primary" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {applyConfirm && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Overwrites current pipeline —</span>
                      <button
                        onClick={() => void applyTemplate()}
                        disabled={applying}
                        className="flex items-center gap-1 rounded border border-destructive/50 bg-background px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        {applying && <Loader2 className="h-3 w-3 animate-spin" />}
                        Confirm
                      </button>
                      <button
                        onClick={() => { setApplyConfirm(false); setSelected(currentTemplate); }}
                        className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {resetParamsConfirm && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Reset all params to defaults —</span>
                      <button
                        onClick={() => void resetParams()}
                        disabled={resettingParams}
                        className="flex items-center gap-1 rounded border border-destructive/50 bg-background px-2 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        {resettingParams && <Loader2 className="h-3 w-3 animate-spin" />}
                        Confirm
                      </button>
                      <button
                        onClick={() => setResetParamsConfirm(false)}
                        className="rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {!applyConfirm && !resetParamsConfirm && (
                    <span className="text-[10px] text-muted-foreground/50">Reset params preserves group structure</span>
                  )}
                </div>

                {/* Pause on failure */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-foreground">Pause on Step Failure</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Auto-pause after a step exhausts all retries. Enables Telegram action buttons.
                    </p>
                  </div>
                  <Switch
                    checked={pauseOnFailure}
                    onCheckedChange={(v) => void handlePauseOnFailureToggle(v)}
                  />
                </div>

                {/* Quick profile presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] text-muted-foreground shrink-0">Quick profile:</span>
                  {PRESETS.map(preset => (
                    <button
                      key={preset.name}
                      disabled={!!applyingPreset}
                      onClick={() => void applyPreset(preset.name)}
                      title={preset.description}
                      className={cn(
                        "rounded px-2 py-0.5 text-[10px] border transition-colors disabled:opacity-50",
                        applyingPreset === preset.name
                          ? "border-primary bg-primary/20 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      )}
                    >
                      {applyingPreset === preset.name && (
                        <Loader2 className="h-2.5 w-2.5 animate-spin inline mr-1" />
                      )}
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Save as template */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">Save as Template</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={saveTemplateName}
                      onChange={(e) => setSaveTemplateName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleSaveTemplate(); }}
                      placeholder="Template name…"
                      className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => void handleSaveTemplate()}
                      disabled={savingTemplate || !saveTemplateName.trim()}
                      className="flex items-center gap-1 rounded border border-primary/50 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50 transition-colors"
                    >
                      {savingTemplate && <Loader2 className="h-3 w-3 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Groups ── */}
      <div className="flex flex-col gap-2.5">
        {groups.flatMap((group, idx) => {
          const skippable    = group.steps.filter(s => s.skippable);
          const enabledCount = skippable.filter(s => s.enabled).length;
          const totalCount   = skippable.length;
          const lockedOnly   = totalCount === 0 && group.steps.some(s => !s.skippable);
          const cat          = getGroupCategory(group, stepMeta);
          const CatIcon      = CATEGORY_ICONS[cat];
          const isOpen       = openGroups.has(group.id);
          const isDeletePending = deleteGroupId === group.id;
          const mutexSteps   = group.steps.filter(s => MUTEX_PAIR.has(s.step_id));
          const showMutex    = mutexSteps.length === 2;
          const regularSteps = group.steps.filter(s =>
            showMutex ? !MUTEX_PAIR.has(s.step_id) : true
          );
          const mutexDepWarning = showMutex && mutexSteps.every(s => !enabledStepIds.has(s.step_id))
            ? getDepWarning("zgrab2_service")
            : undefined;

          const isActive = group.enabled && (enabledCount > 0 || lockedOnly);

          const groupStepIds = new Set(group.steps.map(s => s.step_id));
          const hasIntraGroupDeps = group.steps.some(step =>
            (STEP_DEPS[step.step_id] ?? []).some(dep => groupStepIds.has(dep))
          );
          const showExecMode = totalCount > 1 && !showMutex;

          const prevCat    = idx > 0 ? getGroupCategory(groups[idx - 1], stepMeta) : null;
          const phaseLabel = PHASE_LABELS[cat];
          const showPhase  = phaseLabel && cat !== prevCat;

          // Phase header element — reused in both branches below
          const theme = CATEGORY_THEME[cat];
          const phaseHeader = showPhase ? (
            <div
              key={`phase-${group.id}`}
              className={cn("flex items-center gap-2", idx > 0 ? "mt-3" : "mt-1")}
            >
              <CatIcon className={cn("h-3 w-3 shrink-0", theme.icon, "opacity-50")} />
              <span className={cn("text-[10px] font-semibold uppercase tracking-widest shrink-0", theme.phaseText)}>
                {phaseLabel}
              </span>
              <div className={cn("flex-1 h-px", theme.phaseLine)} />
            </div>
          ) : null;

          // Single non-skippable step → pipeline checkpoint, not a card
          if (lockedOnly && group.steps.length === 1) {
            const step = group.steps[0];
            const stepLabel = stepMeta[step.step_id]?.label ?? step.step_id;
            const eta = etaByGroup[group.id];
            const checkpoint = (
              <div
                key={group.id}
                id={`group-${group.id}`}
                className="flex items-center gap-2 px-1 py-0.5"
              >
                <div className="flex-1 h-px bg-border/25" />
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35 shrink-0">
                  <Lock className={cn("h-2.5 w-2.5", cat !== "action" && cat !== "other" ? cn(theme.icon, "opacity-50") : "text-muted-foreground/30")} />
                  {stepLabel}
                  {eta ? (
                    <span className="text-muted-foreground/25 tabular-nums ml-1">{fmtSeconds(eta)}</span>
                  ) : null}
                </span>
                <div className="flex-1 h-px bg-border/25" />
              </div>
            );
            return phaseHeader ? [phaseHeader, checkpoint] : [checkpoint];
          }

          const card = (
            <div
              key={group.id}
              id={`group-${group.id}`}
              className={cn(
                "group/card rounded-2xl overflow-hidden",
                "bg-card/90 backdrop-blur-xl",
                "border border-l-[3px] border-white/[0.07]",
                theme.cardAccentL,
                "shadow-md shadow-black/20"
              )}
            >
              {/* Category accent bar */}
              <div
                className="h-px w-full shrink-0"
                style={{ background: `linear-gradient(to right, transparent, ${theme.hex}70, transparent)` }}
              />

              {/* Group header */}
              <div
                className={cn(
                  "flex items-center gap-2 px-3 py-3 cursor-pointer select-none transition-colors duration-150",
                  isActive ? "hover:bg-white/[0.04]" : "hover:bg-white/[0.02]"
                )}
                style={{ background: `linear-gradient(to right, ${theme.hex}09, transparent)` }}
                onClick={() => toggleGroup(group.id)}
              >
                <ChevronDown className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
                  !isOpen && "-rotate-90"
                )} />

                <CatIcon className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-opacity",
                  theme.icon,
                  !isActive && "opacity-30"
                )} />

                {/* Group name — text-sm to visually distinguish headers from step rows */}
                <span className={cn(
                  "flex-1 text-sm font-medium truncate min-w-0 transition-colors",
                  group.enabled ? "text-foreground" : "text-muted-foreground/50"
                )}>
                  {group.name}
                </span>

                {/* Step count / locked badge */}
                {lockedOnly ? (
                  <span title="All steps always run — mandatory actions" className="shrink-0 flex items-center">
                    <Lock className="h-3 w-3 text-primary/30" />
                  </span>
                ) : totalCount > 0 ? (
                  <span className={cn(
                    "text-[10px] tabular-nums font-medium shrink-0",
                    enabledCount === totalCount
                      ? "text-muted-foreground/50"
                      : enabledCount === 0
                        ? "text-muted-foreground/25"
                        : "text-amber-500"
                  )}>
                    {enabledCount}/{totalCount}
                  </span>
                ) : null}

                {/* Execution mode badge — desktop only */}
                {showExecMode && (
                  <span className="hidden sm:inline text-[10px] text-muted-foreground/35 shrink-0">
                    {hasIntraGroupDeps ? "→" : group.parallel ? "∥" : "→"}
                  </span>
                )}

                {/* ETA — desktop only */}
                {group.enabled && enabledCount > 0 && etaByGroup[group.id] ? (
                  <span className="hidden sm:flex items-center gap-0.5 text-[10px] text-muted-foreground/40 shrink-0 tabular-nums">
                    <Clock className="h-2.5 w-2.5" />
                    {fmtSeconds(etaByGroup[group.id])}
                  </span>
                ) : null}

                {/* Controls — stop propagation */}
                <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                  <Switch
                    checked={group.enabled}
                    onCheckedChange={(v) => void handleGroupUpdate(group.id, { enabled: v })}
                  />

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
                        className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground border border-white/[0.08] hover:text-foreground transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteGroupId(group.id)}
                      className="text-muted-foreground/0 group-hover/card:text-muted-foreground/35 hover:!text-destructive transition-colors"
                      title="Delete group"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Steps + execution mode */}
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
                      {showExecMode && (
                        <div className="flex items-center gap-2 px-4 py-1.5 border-t border-white/[0.05] bg-white/[0.02]">
                          <span className="text-[10px] text-muted-foreground">Execution</span>
                          {hasIntraGroupDeps ? (
                            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                              <Lock className="h-2.5 w-2.5" />
                              Sequential (step ordering required)
                            </div>
                          ) : (
                            <div className="flex rounded border border-white/[0.08] overflow-hidden text-[10px]">
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
                                  "px-2 py-0.5 border-l border-white/[0.08] transition-colors",
                                  group.parallel ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                                )}
                                title="Run all steps at the same time"
                              >
                                Parallel
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="divide-y divide-white/[0.04] border-t border-white/[0.05]">
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

          return phaseHeader ? [phaseHeader, card] : [card];
        })}
      </div>

    </div>
  );
}
