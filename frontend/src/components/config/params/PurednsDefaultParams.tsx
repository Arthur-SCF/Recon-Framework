import { PARAM_TOOLTIPS } from "../tooltips";
import { InfoTooltip } from "../InfoTooltip";
import { NumberInput } from "./NumberInput";

interface Props {
  stepId: string;
  overrides: Record<string, unknown>;
  onChange: (overrides: Record<string, unknown>) => void;
}

const WORDLIST_OPTIONS = ["small", "medium", "large"] as const;

export function PurednsDefaultParams({ stepId, overrides, onChange }: Props) {
  const wordlist      = (overrides.primary_wordlist     as string) ?? "small";
  const rateLimit     = (overrides.puredns_rate_limit   as number) ?? 20;
  const wildcardBatch = (overrides.puredns_wildcard_batch as number) ?? 25000;

  return (
    <div className="flex flex-col gap-3 py-2">
      {/* Wordlist */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Wordlist</span>
        <div className="flex gap-1">
          {WORDLIST_OPTIONS.map((opt) => (
            <button
              key={opt}
              onClick={() => onChange({ ...overrides, primary_wordlist: opt })}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                wordlist === opt
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:primary_wordlist`]} />
      </div>

      {/* Rate limit */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Rate limit</span>
        <NumberInput
          value={rateLimit} min={1} max={1000}
          onChange={(v) => onChange({ ...overrides, puredns_rate_limit: v })}
          className="w-20 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">qps</span>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:puredns_rate_limit`]} />
      </div>

      {/* Wildcard batch */}
      <div className="flex items-center gap-2">
        <span className="w-28 shrink-0 text-xs text-muted-foreground">Wildcard batch</span>
        <NumberInput
          value={wildcardBatch} min={1000} max={2000000} step={1000}
          onChange={(v) => onChange({ ...overrides, puredns_wildcard_batch: v })}
          className="w-24 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-xs text-muted-foreground">subs/pass</span>
        <InfoTooltip text={PARAM_TOOLTIPS[`${stepId}:puredns_wildcard_batch`]} />
      </div>
    </div>
  );
}
