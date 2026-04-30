import { useState, useCallback, useRef, useEffect } from "react";
import { Lock, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "@/types/api";
import { STEP_TOOLTIPS } from "./tooltips";
import { InfoTooltip } from "./InfoTooltip";
import { Switch } from "@/components/ui/switch";
import { Sheet } from "@/components/ui/sheet";
import { DynamicParamForm } from "./dynamic/DynamicParamForm";
import { useActionFetch } from "@/hooks/useActionFetch";

// Hex accent colors per step — mirrors CATEGORY_THEME in TargetConfig.
export
const STEP_ACCENT: Record<string, string> = {
  // passive — blue
  subfinder: "#54a2ff", amass: "#54a2ff", tlsx: "#54a2ff",
  assetfinder: "#54a2ff", crt_sh: "#54a2ff", gau: "#54a2ff",
  s3scanner: "#54a2ff", wafw00f: "#54a2ff",
  // dns — cyan
  puredns_default: "#00d2ef", puredns_permutation: "#00d2ef", puredns_custom: "#00d2ef",
  alterx: "#00d2ef", cewl: "#00d2ef", subdomainizer: "#00d2ef",
  // http — emerald
  httpx_r1: "#00d294", httpx_r2: "#00d294", httpx_r3: "#00d294", httpx_ports: "#00d294",
  // ports — orange
  naabu: "#ff8b1a",
  // service — violet
  zgrab2_service: "#a685ff", nmap_service: "#a685ff",
  // js — yellow
  katana: "#fac800",
  // takeover — red
  nuclei_takeover: "#ff6568",
  // screenshots — pink
  gowitness: "#fb64b6",
  // cloud — sky
  cloud_enum: "#00bcfe",
};

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown>>(
    step.config_overrides ?? {}
  );
  const debounceRef  = useRef<ReturnType<typeof setTimeout>>(null);
  const isPendingRef = useRef(false);

  useEffect(() => {
    if (!isPendingRef.current) setLocalOverrides(step.config_overrides ?? {});
  }, [step.config_overrides]);

  const hasParams   = PARAM_STEP_IDS.has(step.step_id);
  const stepTooltip = STEP_TOOLTIPS[step.step_id] ?? "";
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

  // Locked (BaseAction) — always runs, not user-configurable
  if (!step.skippable) {
    return (
      <div className="group flex items-center gap-2 px-3 py-2 bg-white/[0.02]">
        <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
        <Lock className="h-3 w-3 shrink-0 text-primary/40" />
        <span className="flex-1 text-xs text-foreground/50">{label ?? step.step_id}</span>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <InfoTooltip text={stepTooltip || "Always runs — mandatory pipeline step, cannot be disabled."} />
        </span>
      </div>
    );
  }

  return (
    <div className={cn("last:border-0", !step.enabled && "opacity-60")}>
      {/* Row — `group` enables hover-reveal for secondary controls */}
      <div
        className="group flex items-center gap-2 px-3 py-2.5 tap-compact hover:bg-white/[0.025] transition-colors duration-100"
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

        {/* Modified indicator — always visible, it's a state signal */}
        {hasOverrides && (
          <span
            className="text-[10px] text-primary/70 shrink-0"
            title="Parameters modified from template defaults"
          >
            ◆
          </span>
        )}

        {/* Dependency warning — always visible, it's a state signal */}
        {depWarning && step.enabled && (
          <span
            title={depWarning}
            className="text-[10px] text-amber-500 shrink-0 cursor-help"
            aria-label={depWarning}
          >
            ⚠
          </span>
        )}

        {/* Saving indicator — always visible while active */}
        {saving && (
          <span className="text-[10px] text-muted-foreground shrink-0">saving…</span>
        )}

        {/* Info tooltip — revealed on hover/focus */}
        <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
          <InfoTooltip text={stepTooltip} />
        </span>

        {/* Param opener — revealed on hover/focus */}
        {hasParams && (
          <span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => setSheetOpen(true)}
              title="Edit parameters"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>

      {/* Sheet param editor */}
      {hasParams && (
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={label ?? step.step_id}
          subtitle={saving ? "saving…" : undefined}
          accentColor={STEP_ACCENT[step.step_id]}
        >
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
