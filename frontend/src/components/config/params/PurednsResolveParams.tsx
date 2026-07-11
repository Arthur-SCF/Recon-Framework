import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function PurednsResolveParams({ stepId, overrides, onChange }: Props) {
  const rateLimit = (overrides.puredns_resolve_rate_limit as number) ?? 50;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Rate limit</span>
        <NumberInput
          value={rateLimit} min={1} max={2000}
          onChange={(v) => onChange({ ...overrides, puredns_resolve_rate_limit: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="font-mono text-[10px] text-muted-foreground">qps</span>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:puredns_resolve_rate_limit`]} />
      </div>
    </div>
  );
}
