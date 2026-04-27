import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function GauParams({ stepId, overrides, onChange }: Props) {
  const providers = (overrides.gau_providers as string) ?? "wayback,otx,urlscan";
  const timeout   = (overrides.gau_timeout   as number) ?? 30;
  const threads   = (overrides.threads       as number) ?? 2;

  function field(label: string, key: string, val: number, min: number, max: number, suffix?: string) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
        <NumberInput
          value={val} min={min} max={max}
          onChange={(v) => onChange({ ...overrides, [key]: v })}
          className="w-20 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:${key}`] ?? ""} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Providers</span>
        <input
          type="text"
          value={providers}
          onChange={(e) => onChange({ ...overrides, gau_providers: e.target.value })}
          placeholder="wayback,otx,urlscan"
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:gau_providers`] ?? ""} />
      </div>
      {field("Timeout", "gau_timeout", timeout, 5, 300, "s/source")}
      {field("Threads",  "threads",    threads, 1, 20)}
    </div>
  );
}
