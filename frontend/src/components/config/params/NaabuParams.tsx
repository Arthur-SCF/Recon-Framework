import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

const PORT_OPTIONS = ["1000", "5000", "full"] as const;

export function NaabuParams({ stepId, overrides, onChange }: Props) {
  const topPorts = (overrides.top_ports as string) ?? "1000";
  const rate = (overrides.rate as number) ?? 1000;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Top ports</span>
        <div className="flex gap-1">
          {PORT_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange({ ...overrides, top_ports: opt })}
              className={`px-2 py-1 font-mono text-xs tabular-nums rounded-md border transition-colors ${
                topPorts === opt
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:top_ports`]} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Rate</span>
        <NumberInput
          value={rate} min={1} max={10000}
          onChange={(v) => onChange({ ...overrides, rate: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="font-mono text-[10px] text-muted-foreground">pps</span>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:rate`]} />
      </div>
    </div>
  );
}
