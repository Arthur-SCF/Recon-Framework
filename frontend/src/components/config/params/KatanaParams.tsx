import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function KatanaParams({ stepId, overrides, onChange }: Props) {
  const depth       = (overrides.depth       as number) ?? 3;
  const concurrency = (overrides.concurrency as number) ?? 10;
  const timeout     = (overrides.timeout     as number) ?? 10;

  function field(label: string, key: string, val: number, min: number, max: number, suffix?: string, tooltip?: string) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
        <NumberInput
          value={val} min={min} max={max}
          onChange={(v) => onChange({ ...overrides, [key]: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {suffix && <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>}
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      {field("Depth",       "depth",       depth,       1, 10,   undefined, PARAM_TOOLTIPS[`${stepId}:depth`])}
      {field("Concurrency", "concurrency", concurrency, 1, 100,  undefined, PARAM_TOOLTIPS[`${stepId}:concurrency`])}
      {field("Timeout",     "timeout",     timeout,     1, 120, "s",       PARAM_TOOLTIPS[`${stepId}:timeout`])}
    </div>
  );
}
