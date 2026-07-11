import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

const PATTERN_OPTIONS = [
  { value: "default",    label: "default" },
  { value: "aggressive", label: "aggressive" },
] as const;

export function AlterxParams({ stepId, overrides, onChange }: Props) {
  const pattern = (overrides.pattern_file as string) ?? "default";

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Pattern set</span>
        <div className="flex gap-1">
          {PATTERN_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onChange({ ...overrides, pattern_file: value })}
              className={`px-2 py-1 font-mono text-xs rounded-md border transition-colors ${
                pattern === value
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:pattern_file`]} />
      </div>
    </div>
  );
}
