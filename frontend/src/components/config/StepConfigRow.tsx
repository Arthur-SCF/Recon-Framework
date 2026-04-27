import { useState, useCallback, useRef, useEffect } from "react";
import { ChevronDown, ChevronRight, Lock, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "@/types/api";
import { STEP_TOOLTIPS } from "./tooltips";
import { InfoTooltip } from "./InfoTooltip";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { DynamicParamForm } from "./dynamic/DynamicParamForm";
import { useActionFetch } from "@/hooks/useActionFetch";

// Steps that have configurable parameters.
const PARAM_STEP_IDS = new Set([
  "puredns_default", "puredns_permutation", "puredns_custom",
  "alterx",
  "httpx_r1", "httpx_r2", "httpx_r3", "httpx_ports",
  "naabu",
  "katana",
  "subfinder",
  "gowitness",
  "nuclei_takeover",
  "cewl", "subdomainizer", "amass",
  "gau", "tlsx", "assetfinder", "crt_sh",
  "cloud_enum",
  "zgrab2_service",
  "s3scanner", "wafw00f",
  "nmap_service",
]);

// Steps whose param forms are complex enough to warrant a right-side Sheet
// drawer rather than an inline expand.  Simple steps (≤2 basic fields) keep
// the collapsible behaviour.
const SHEET_STEP_IDS = new Set([
  "httpx_r1", "httpx_r2", "httpx_r3", "httpx_ports",
  "naabu",
  "subfinder",
  "puredns_default", "puredns_permutation", "puredns_custom",
  "alterx",
  "katana",
  "gau",
  "gowitness",
  "nuclei_takeover",
  "cloud_enum",
  "zgrab2_service",
  "nmap_service",
]);

// Legacy shim — PARAM_COMPONENTS is still imported by MutexStepGroup to check
// whether a step has params.  Point every entry at DynamicParamForm so
// existing call sites keep working without changes.
export const PARAM_COMPONENTS: Record<string, React.ComponentType<{
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (o: Record<string, unknown>) => void;
}>> = Object.fromEntries(
  [...PARAM_STEP_IDS].map(id => [id, DynamicParamForm])
);

interface Props {
  targetId: string;
  step: PipelineStep;
  onUpdated: () => void;
  /** Warning message shown when upstream dependencies are disabled */
  depWarning?: string;
  /** Human-readable label (from stepMeta); falls back to step_id */
  label?: string;
}

export function StepConfigRow({ targetId, step, onUpdated, depWarning, label }: Props) {
  const { actionFetch } = useActionFetch();
  const [expanded,       setExpanded]       = useState(false);
  const [sheetOpen,      setSheetOpen]      = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown>>(
    step.config_overrides ?? {}
  );
  const debounceRef  = useRef<ReturnType<typeof setTimeout>>(null);
  const isPendingRef = useRef(false);

  useEffect(() => {
    if (!isPendingRef.current) setLocalOverrides(step.config_overrides ?? {});
  }, [step.config_overrides]);

  const hasParams    = PARAM_STEP_IDS.has(step.step_id);
  const useSheet     = SHEET_STEP_IDS.has(step.step_id);
  const stepTooltip  = STEP_TOOLTIPS[step.step_id] ?? "";
  const hasOverrides = Object.keys(step.config_overrides ?? {}).length > 0;

  const handleToggle = async (enabled: boolean) => {
    const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/steps/${step.id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ enabled }),
      errorPrefix: "Toggle step failed",
    });
    if (!res) return;
    onUpdated();
  };

  const handleParamChange = useCallback(
    (newOverrides: Record<string, unknown>) => {
      setLocalOverrides(newOverrides);
      isPendingRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/steps/${step.id}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ config_overrides: newOverrides }),
          errorPrefix: "Save parameters failed",
        });
        setSaving(false);
        isPendingRef.current = false;
        if (!res) return;
        onUpdated();
      }, 800);
    },
    [targetId, step.id, onUpdated, actionFetch]
  );

  // Locked (BaseAction) — dimmed, lock icon, no controls
  if (!step.skippable) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 opacity-40">
        {/* Status dot — gray for locked */}
        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
        <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-xs text-muted-foreground">{label ?? step.step_id}</span>
        <InfoTooltip text={stepTooltip} />
      </div>
    );
  }

  return (
    <div className={cn("border-b border-border/50 last:border-0", !step.enabled && "opacity-60")}>
      {/* Row header — data-step-row makes it navigable via keyboard shortcuts */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 tap-compact"
        data-step-row
        tabIndex={0}
      >
        {/* Status dot */}
        <span className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0 transition-colors",
          step.enabled ? "bg-green-500" : "bg-amber-500/60"
        )} />

        {/* Toggle */}
        <Switch
          checked={step.enabled}
          onCheckedChange={(v) => void handleToggle(v)}
        />

        {/* Label */}
        <span className="flex-1 text-xs text-foreground">{label ?? step.step_id}</span>

        {/* Modified indicator */}
        {hasOverrides && (
          <span
            className="text-[10px] text-primary/70 shrink-0"
            title="Parameters modified from template defaults"
          >
            ◆
          </span>
        )}

        {/* Dependency warning */}
        {depWarning && step.enabled && (
          <span
            title={depWarning}
            className="text-[10px] text-amber-500 shrink-0 cursor-help"
            aria-label={depWarning}
          >
            ⚠
          </span>
        )}

        {/* Saving indicator */}
        {saving && (
          <span className="text-[10px] text-muted-foreground shrink-0">saving…</span>
        )}

        {/* Info tooltip */}
        <InfoTooltip text={stepTooltip} />

        {/* Param opener — gear icon for Sheet, chevron for inline */}
        {hasParams && (
          useSheet ? (
            <button
              onClick={() => setSheetOpen(true)}
              title="Edit parameters"
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {expanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />
              }
            </button>
          )
        )}
      </div>

      {/* Inline param form (simple steps) */}
      {!useSheet && expanded && hasParams && (
        <div className="px-6 pb-3">
          <DynamicParamForm
            stepId={step.step_id}
            overrides={localOverrides}
            onChange={handleParamChange}
          />
        </div>
      )}

      {/* Sheet param editor (complex steps) */}
      {useSheet && (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={`${label ?? step.step_id} — Parameters`}
        >
          {saving && (
            <p className="text-[10px] text-muted-foreground mb-2">saving…</p>
          )}
          <DynamicParamForm
            stepId={step.step_id}
            overrides={localOverrides}
            onChange={handleParamChange}
          />
        </Sheet>
      )}
    </div>
  );
}
