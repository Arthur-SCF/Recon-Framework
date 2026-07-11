import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

function NumberField({
  label, paramKey, defaultVal, min, max, suffix, tooltip, overrides, onChange,
}: {
  label: string; paramKey: string; defaultVal: number;
  min: number; max: number; suffix?: string; tooltip: string;
  overrides: Record<string, unknown>;
  onChange: (o: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <NumberInput
        value={(overrides[paramKey] as number) ?? defaultVal}
        min={min} max={max}
        onChange={(v) => onChange({ ...overrides, [paramKey]: v })}
        className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {suffix && <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>}
      <InfoTooltip text={tooltip} />
    </div>
  );
}

export function HttpxParams({ stepId, overrides, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3 py-2">
      <NumberField label="Threads"    paramKey="threads"    defaultVal={50}  min={1} max={500}  overrides={overrides} onChange={onChange} tooltip={PARAM_TOOLTIPS[`${stepId}:threads`] ?? ""} />
      <NumberField label="Timeout"    paramKey="timeout"    defaultVal={10}  min={1} max={120}  suffix="s" overrides={overrides} onChange={onChange} tooltip={PARAM_TOOLTIPS[`${stepId}:timeout`] ?? ""} />
      <NumberField label="Rate limit" paramKey="rate_limit" defaultVal={150} min={1} max={2000} suffix="req/s" overrides={overrides} onChange={onChange} tooltip={PARAM_TOOLTIPS[`${stepId}:rate_limit`] ?? ""} />
    </div>
  );
}
