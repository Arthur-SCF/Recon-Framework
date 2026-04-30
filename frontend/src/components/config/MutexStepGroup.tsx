import { useState, useCallback, useRef, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PipelineStep } from "@/types/api";
import { PARAM_COMPONENTS, STEP_ACCENT } from "./StepConfigRow";
import { STEP_TOOLTIPS } from "./tooltips";
import { InfoTooltip } from "./InfoTooltip";
import { Sheet } from "@/components/ui/sheet";
import { DynamicParamForm } from "./dynamic/DynamicParamForm";
import { useActionFetch } from "@/hooks/useActionFetch";

interface Props {
  steps: PipelineStep[];   // exactly the mutex pair, e.g. [zgrab2_service, nmap_service]
  targetId: string;
  onUpdated: () => void;
  depWarning?: string;
  /** Human-readable labels keyed by step_id */
  stepLabels?: Record<string, string>;
}

interface StepParamEditorProps {
  step: PipelineStep;
  targetId: string;
  onUpdated: () => void;
}

function StepParamEditor({ step, targetId, onUpdated }: StepParamEditorProps) {
  const [saving, setSaving] = useState(false);
  const [localOverrides, setLocalOverrides] = useState<Record<string, unknown>>(
    step.config_overrides ?? {}
  );
  const debounceRef  = useRef<ReturnType<typeof setTimeout>>(null);
  const isPendingRef = useRef(false);

  useEffect(() => {
    if (!isPendingRef.current) setLocalOverrides(step.config_overrides ?? {});
  }, [step.config_overrides]);

  if (!PARAM_COMPONENTS[step.step_id]) return null;

  const handleChange = useCallback(
    (newOverrides: Record<string, unknown>) => {
      setLocalOverrides(newOverrides);
      isPendingRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        await fetch(`/api/v1/targets/${targetId}/pipeline/steps/${step.id}`, {
          method:  "PUT",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ config_overrides: newOverrides }),
        });
        setSaving(false);
        isPendingRef.current = false;
        onUpdated();
      }, 800);
    },
    [targetId, step.id, onUpdated]
  );

  return (
    <div>
      {saving && <span className="text-[10px] text-muted-foreground block mb-2">saving…</span>}
      <DynamicParamForm
        stepId={step.step_id}
        overrides={localOverrides}
        onChange={handleChange}
      />
    </div>
  );
}

export function MutexStepGroup({ steps, targetId, onUpdated, depWarning, stepLabels }: Props) {
  const { actionFetch } = useActionFetch();
  const [saving, setSaving] = useState(false);
  const [sheetStep, setSheetStep] = useState<string | null>(null);

  // Which step_id is currently enabled (or null = neither)
  const selected = steps.find(s => s.enabled)?.step_id ?? null;

  const handleSelect = async (chosenStepId: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      if (chosenStepId === null) {
        // Neither — disable all
        const results = await Promise.all(steps.map(s =>
          actionFetch(`/api/v1/targets/${targetId}/pipeline/steps/${s.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: false }),
            errorPrefix: "Toggle step failed",
          })
        ));
        if (results.some(r => r === null)) return;
      } else {
        // Enable chosen — backend mutex logic disables the sibling automatically
        const chosenStep = steps.find(s => s.step_id === chosenStepId)!;
        const res = await actionFetch(`/api/v1/targets/${targetId}/pipeline/steps/${chosenStep.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true }),
          errorPrefix: "Toggle step failed",
        });
        if (!res) return;
      }
      onUpdated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-b border-border/50 last:border-0">
      {/* Section label */}
      <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Service Fingerprinting
        </span>
        <span className="text-[10px] text-muted-foreground/60">— choose one</span>
        {depWarning && (
          <span
            title={depWarning}
            className="ml-auto text-amber-500 cursor-help"
            aria-label={depWarning}
          >
            ⚠
          </span>
        )}
      </div>

      {/* Radio options */}
      <div className="pb-1 tap-compact" role="radiogroup" aria-label="Service fingerprinting tool">
        {steps.map((step) => {
          const isSelected = step.step_id === selected;
          const tooltip = STEP_TOOLTIPS[step.step_id] ?? "";
          const hasParams = !!PARAM_COMPONENTS[step.step_id];
          const hasOverrides = Object.keys(step.config_overrides ?? {}).length > 0;

          return (
            <div key={step.id}>
              <div className={cn(
                "flex items-center gap-2.5 px-3 py-2 transition-colors",
                isSelected ? "bg-muted/20" : "hover:bg-muted/10",
                !isSelected && "opacity-60"
              )}>
                {/* Radio circle */}
                <button
                  role="radio"
                  aria-checked={isSelected}
                  disabled={saving}
                  onClick={() => void handleSelect(isSelected ? null : step.step_id)}
                  className={cn(
                    "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    isSelected ? "border-primary" : "border-muted-foreground/40 hover:border-muted-foreground"
                  )}
                >
                  {isSelected && <span className="w-2 h-2 rounded-full bg-primary block" />}
                </button>

                {/* Step label */}
                <span className={cn("flex-1 text-xs", isSelected ? "text-foreground" : "text-muted-foreground")}>
                  {stepLabels?.[step.step_id] ?? step.step_id}
                </span>

                {/* Modified indicator */}
                {hasOverrides && (
                  <span className="text-[10px] text-primary/70" title="Parameters modified from defaults">◆</span>
                )}

                {/* Tooltip */}
                <InfoTooltip text={tooltip} />

                {/* Open params Sheet (only if selected and has params) */}
                {isSelected && hasParams && (
                  <button
                    title="Edit parameters"
                    onClick={() => setSheetStep(step.step_id)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Neither option */}
        <div className={cn(
          "flex items-center gap-2.5 px-3 py-2 hover:bg-muted/10 transition-colors",
          selected !== null && "opacity-60"
        )}>
          <button
            role="radio"
            aria-checked={selected === null}
            disabled={saving}
            onClick={() => void handleSelect(null)}
            className={cn(
              "w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected === null ? "border-primary" : "border-muted-foreground/40 hover:border-muted-foreground"
            )}
          >
            {selected === null && <span className="w-2 h-2 rounded-full bg-primary block" />}
          </button>
          <span className={cn("text-xs", selected === null ? "text-foreground" : "text-muted-foreground")}>
            Neither
          </span>
        </div>
      </div>

      {/* Sheet param editors — one per step, mounted lazily */}
      {steps.map(step => (
        PARAM_COMPONENTS[step.step_id] ? (
          <Sheet
            key={step.step_id}
            open={sheetStep === step.step_id}
            onClose={() => setSheetStep(null)}
            title={`${stepLabels?.[step.step_id] ?? step.step_id} — Parameters`}
            accentColor={STEP_ACCENT[step.step_id]}
          >
            <StepParamEditor step={step} targetId={targetId} onUpdated={onUpdated} />
          </Sheet>
        ) : null
      ))}
    </div>
  );
}
