import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function SubfinderParams({ stepId, overrides, onChange }: Props) {
  const threads = (overrides.threads as number) ?? 10;
  const timeout = (overrides.timeout as number) ?? 30;

  return (
    <div className="flex flex-col gap-3 py-2">
      {[
        { label: "Threads", key: "threads", val: threads, min: 1, max: 100, suffix: undefined },
        { label: "Timeout", key: "timeout", val: timeout, min: 1, max: 300, suffix: "s/source" },
      ].map(({ label, key, val, min, max, suffix }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
          <NumberInput
            value={val} min={min} max={max}
            onChange={(v) => onChange({ ...overrides, [key]: v })}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {suffix && <span className="font-mono text-[10px] text-muted-foreground">{suffix}</span>}
          <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:${key}`] ?? ""} />
        </div>
      ))}
    </div>
  );
}
