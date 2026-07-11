import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { GeneralSettings } from "@/types/api";

export function GeneralTab() {
  const [cfg, setCfg] = useState<GeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const { actionFetch, pending: saving } = useActionFetch();

  const fetchCfg = useCallback(async () => {
    const res = await fetch("/api/v1/settings/");
    if (res.ok) setCfg((await res.json()) as GeneralSettings);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchCfg(); }, [fetchCfg]);

  async function save() {
    if (!cfg) return;
    const res = await actionFetch("/api/v1/settings/", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
      errorPrefix: "Save settings",
      successMessage: "Settings saved",
    });
    if (!res) return;
    setCfg((await res.json()) as GeneralSettings);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!cfg) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Failed to load settings.
      </p>
    );
  }

  return (
    <div className="py-6 max-w-lg space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Disk Pause Threshold</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pause new scans when disk usage exceeds this percentage.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={50}
            max={99}
            value={cfg.disk_pause_threshold}
            onChange={(e) =>
              setCfg({ ...cfg, disk_pause_threshold: Number(e.target.value) })
            }
            className="w-24 rounded-md border border-border bg-input px-3 py-2 font-mono text-sm tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Scheduler Mode</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            How the scheduler picks the next scan to run.
          </p>
        </div>
        <div className="space-y-2">
          {(
            [
              { value: "sequential" as const, label: "Sequential", desc: "Scans run in the order they were queued." },
              { value: "priority"   as const, label: "Priority Queue", desc: "Higher-priority targets run first." },
            ] as const
          ).map(({ value, label, desc }) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                cfg.scheduler_mode === value
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50",
              )}
            >
              <input
                type="radio"
                name="scheduler_mode"
                value={value}
                checked={cfg.scheduler_mode === value}
                onChange={() => setCfg({ ...cfg, scheduler_mode: value })}
                className="mt-0.5 accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <div>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>
    </div>
  );
}
