import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

export function Zgrab2Params({ stepId, overrides, onChange }: Props) {
  const senders = (overrides.zgrab2_senders as number) ?? 100;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Senders</span>
        <NumberInput
          value={senders} min={1} max={1000}
          onChange={(v) => onChange({ ...overrides, zgrab2_senders: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:zgrab2_senders`] ?? ""} />
      </div>
    </div>
  );
}
