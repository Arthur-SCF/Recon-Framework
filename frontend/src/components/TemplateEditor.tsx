import { useState } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { PARAM_COMPONENTS } from "@/components/config/StepConfigRow";
import type { PipelineTemplateFull } from "@/types/api";

// Must match backend _MUTEX_GROUPS in pipeline_config.py
const MUTEX_GROUPS: ReadonlySet<string>[] = [
  new Set(["zgrab2_service", "nmap_service"]),
];

type TemplateConfig = PipelineTemplateFull["config"];

interface TemplateStepConfig {
  step_id: string;
  position: number;
  enabled: boolean;
  config_overrides?: Record<string, unknown>;
}

interface TemplateGroupConfig {
  id: string;
  name: string;
  position: number;
  parallel: boolean;
  enabled: boolean;
  steps: TemplateStepConfig[];
}

interface Props {
  config: TemplateConfig | null;
  onChange: (config: TemplateConfig) => void;
}

interface TemplateStepRowProps {
  groupIdx: number;
  stepIdx: number;
  step: TemplateStepConfig;
  config: TemplateConfig;
  onChange: (config: TemplateConfig) => void;
}

function TemplateStepRow({ groupIdx, stepIdx, step, config, onChange }: TemplateStepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const ParamComponent = PARAM_COMPONENTS[step.step_id] ?? null;

  function updateStep(patch: Partial<TemplateStepConfig>) {
    let groups = config.groups.map((g, gi) => {
      if (gi !== groupIdx) return g;
      return {
        ...g,
        steps: g.steps.map((s, si) =>
          si === stepIdx ? { ...s, ...patch } : s
        ),
      };
    }) as TemplateGroupConfig[];

    // Mutex: enabling one tool in a mutex group disables all siblings across all groups
    if (patch.enabled === true) {
      const mutexGroup = MUTEX_GROUPS.find((mg) => mg.has(step.step_id));
      if (mutexGroup) {
        const siblings = new Set([...mutexGroup].filter((id) => id !== step.step_id));
        groups = groups.map((g) => ({
          ...g,
          steps: g.steps.map((s) =>
            siblings.has(s.step_id) ? { ...s, enabled: false } : s
          ),
        }));
      }
    }

    onChange({ groups });
  }

  return (
    <div className={cn("border-b border-border/50 last:border-0", !step.enabled && "opacity-60")}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        {/* Toggle */}
        <button
          role="switch"
          aria-checked={step.enabled}
          onClick={() => updateStep({ enabled: !step.enabled })}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            step.enabled ? "bg-primary" : "bg-muted"
          )}
        >
          <span className={cn(
            "toggle-thumb pointer-events-none inline-block h-3 w-3 rounded-full transition-transform",
            step.enabled ? "translate-x-3" : "translate-x-0"
          )} />
        </button>

        <span className="flex-1 text-xs text-foreground font-mono">{step.step_id}</span>

        {!step.enabled && (
          <span className="rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sev-medium bg-sev-medium/10 border border-sev-medium/20">
            SKIPPED
          </span>
        )}

        {ParamComponent && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {expanded && ParamComponent && (
        <div className="px-6 pb-3">
          <ParamComponent
            stepId={step.step_id}
            overrides={step.config_overrides ?? {}}
            onChange={(overrides) => updateStep({ config_overrides: overrides })}
          />
        </div>
      )}
    </div>
  );
}

export function TemplateEditor({ config, onChange }: Props) {
  if (!config) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {config.groups.map((group, gi) => {
        const hasMutexConflict = MUTEX_GROUPS.some(
          (mg) => group.steps.filter((s) => mg.has(s.step_id)).length > 1
        );
        return (
        <div key={group.id ?? gi} className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">{group.name}</span>
            {group.parallel && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">parallel</span>
            )}
            {hasMutexConflict && (
              <span className="rounded bg-sev-medium/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sev-medium border border-sev-medium/20">
                choose one
              </span>
            )}
          </div>
          <div className="divide-y divide-border/50">
            {group.steps.map((step, si) => (
              <TemplateStepRow
                key={`${step.step_id}-${step.position}`}
                groupIdx={gi}
                stepIdx={si}
                step={step}
                config={config}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
