import { cn } from "@/lib/utils";
import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function CloudEnumParams({ stepId, overrides, onChange }: Props) {
  const threads     = (overrides.cloud_enum_threads    as number)  ?? 20;
  const quickscan   = (overrides.cloud_enum_quickscan  as boolean) ?? true;
  const disableAws  = (overrides.cloud_enum_disable_aws   as boolean) ?? false;
  const disableAzure = (overrides.cloud_enum_disable_azure as boolean) ?? false;
  const disableGcp  = (overrides.cloud_enum_disable_gcp   as boolean) ?? false;

  function toggle(label: string, key: string, val: boolean) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
        <button
          role="switch"
          aria-checked={val}
          onClick={() => onChange({ ...overrides, [key]: !val })}
          className={cn(
            "relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            val ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "toggle-thumb pointer-events-none inline-block h-3 w-3 rounded-full transition-transform",
              val ? "translate-x-3" : "translate-x-0"
            )}
          />
        </button>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:${key}`] ?? ""} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Threads</span>
        <NumberInput
          value={threads} min={1} max={100}
          onChange={(v) => onChange({ ...overrides, cloud_enum_threads: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:cloud_enum_threads`] ?? ""} />
      </div>
      {toggle("Quick Scan",    "cloud_enum_quickscan",    quickscan)}
      {toggle("Disable AWS",   "cloud_enum_disable_aws",  disableAws)}
      {toggle("Disable Azure", "cloud_enum_disable_azure", disableAzure)}
      {toggle("Disable GCP",   "cloud_enum_disable_gcp",  disableGcp)}
    </div>
  );
}
