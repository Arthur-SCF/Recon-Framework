import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

interface TimeoutConfig {
  paramKey: string;
  default: number;
  min: number;
  max: number;
  unit: string;
  label: string;
}

/**
 * Per-tool timeout configuration.
 * Each tool has a different config key, unit, and sensible range.
 */
const TOOL_TIMEOUT_CONFIG: Record<string, TimeoutConfig> = {
  amass: {
    paramKey: "timeout_minutes",
    default: 10, min: 1, max: 120,
    unit: "min", label: "Timeout",
  },
  tlsx: {
    paramKey: "timeout_per_host",
    default: 10, min: 1, max: 60,
    unit: "s/host", label: "Timeout per host",
  },
  gau: {
    paramKey: "gau_timeout",
    default: 30, min: 5, max: 300,
    unit: "s/source", label: "Timeout per source",
  },
  cewl: {
    paramKey: "timeout",
    default: 300, min: 10, max: 1800,
    unit: "s", label: "Timeout",
  },
  nuclei_takeover: {
    paramKey: "timeout",
    default: 600, min: 30, max: 3600,
    unit: "s", label: "Process timeout",
  },
  subdomainizer: {
    paramKey: "timeout",
    default: 300, min: 10, max: 1800,
    unit: "s", label: "Timeout",
  },
  assetfinder: {
    paramKey: "timeout",
    default: 180, min: 10, max: 600,
    unit: "s", label: "Timeout",
  },
  crt_sh: {
    paramKey: "timeout",
    default: 30, min: 5, max: 300,
    unit: "s", label: "Timeout",
  },
  s3scanner: {
    paramKey: "timeout",
    default: 300, min: 10, max: 1800,
    unit: "s", label: "Timeout",
  },
  wafw00f: {
    paramKey: "timeout",
    default: 120, min: 10, max: 600,
    unit: "s", label: "Timeout",
  },
  nmap_service: {
    paramKey: "timeout",
    default: 600, min: 60, max: 3600,
    unit: "s", label: "Timeout",
  },
};

export function GenericTimeoutParams({ stepId, overrides, onChange }: Props) {
  const cfg = TOOL_TIMEOUT_CONFIG[stepId];
  if (!cfg) return null;

  const value = (overrides[cfg.paramKey] as number) ?? cfg.default;
  const tooltipKey = `${stepId}:${cfg.paramKey}`;

  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-36 shrink-0 text-xs text-muted-foreground">{cfg.label}</span>
        <NumberInput
          value={value}
          min={cfg.min}
          max={cfg.max}
          onChange={(v) => onChange({ ...overrides, [cfg.paramKey]: v })}
          className="w-20 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs tabular-nums text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="font-mono text-[10px] text-muted-foreground">{cfg.unit}</span>
        <InfoTooltip text={PARAM_TOOLTIPS[tooltipKey] ?? ""} />
      </div>
    </div>
  );
}
