import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function GoWitnessParams({ stepId, overrides, onChange }: Props) {
  const threads = (overrides.gowitness_threads as number) ?? 4;
  const delay   = (overrides.gowitness_delay   as number) ?? 1;
  const timeout = (overrides.gowitness_timeout as number) ?? 10;

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
      {field("Threads", "gowitness_threads", threads, 1, 20)}
      {field("Delay",   "gowitness_delay",   delay,   0, 30, "s")}
      {field("Timeout", "gowitness_timeout", timeout, 1, 60, "s/screenshot")}
    </div>
  );
}
