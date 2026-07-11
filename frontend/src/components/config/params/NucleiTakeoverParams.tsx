import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function NucleiTakeoverParams({ stepId, overrides, onChange }: Props) {
  const rateLimit   = (overrides.nuclei_rate_limit   as number) ?? 100;
  const bulkSize    = (overrides.nuclei_bulk_size    as number) ?? 50;
  const concurrency = (overrides.nuclei_concurrency  as number) ?? 25;

  function field(label: string, key: string, val: number, min: number, max: number, suffix?: string) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
        <NumberInput
          value={val} min={min} max={max}
          onChange={(v) => onChange({ ...overrides, [key]: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {suffix && <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>}
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:${key}`] ?? ""} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {field("Rate Limit",   "nuclei_rate_limit",  rateLimit,   1, 1000, "req/s")}
      {field("Bulk Size",    "nuclei_bulk_size",   bulkSize,    1, 500)}
      {field("Concurrency",  "nuclei_concurrency", concurrency, 1, 200)}
    </div>
  );
}
