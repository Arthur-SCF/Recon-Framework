import { useCallback, useEffect, useState } from "react";
import { Globe, MonitorSmartphone, Layers, AlertTriangle } from "lucide-react";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import { InlineError } from "@/components/ui/InlineError";

interface StatsOverview {
  totals: {
    targets: number;
    hosts: number;
    subdomains: number;
    takeovers: number;
  };
}

interface Stats {
  targets: number;
  live_hosts: number;
  subdomains: number;
  takeovers: number;
}

export function SidebarQuickStats({ collapsed }: { collapsed: boolean }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetch("/api/v1/stats/overview")
      .then((r) => (r.ok ? (r.json() as Promise<StatsOverview>) : null))
      .then((data) => {
        if (!data) { setStats(null); return; }
        setFetchError(null);
        setStats({
          targets:   data.totals.targets,
          live_hosts: data.totals.hosts,
          subdomains: data.totals.subdomains,
          takeovers:  data.totals.takeovers ?? 0,
        });
      })
      .catch(() => { setFetchError("Failed to load"); setStats(null); });
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  // Refresh immediately when discovery events fire
  useWsSubscribe(
    ["new_hosts", "new_subdomains", "takeover_candidate", "scan_completed"],
    load,
  );

  if (!stats && !fetchError) return null;
  if (fetchError) {
    return (
      <div className="px-3 py-2">
        <InlineError message={fetchError} onRetry={load} compact />
      </div>
    );
  }
  if (!stats) return null;

  const rows = [
    { icon: Globe, label: "Targets", value: stats.targets },
    { icon: MonitorSmartphone, label: "Hosts", value: stats.live_hosts },
    { icon: Layers, label: "Subs", value: stats.subdomains },
    { icon: AlertTriangle, label: "Takeovers", value: stats.takeovers },
  ];

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 px-1 py-2">
        {rows.map(({ icon: Icon, label, value }) => (
          <div
            key={label}
            title={`${label}: ${value}`}
            className="flex flex-col items-center"
          >
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[9px] font-mono tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-faint-foreground mb-1.5">
        <span className="h-2 w-0.5 rounded-full bg-primary/60" aria-hidden="true" />
        Quick Stats
      </p>
      <div className="space-y-1">
        {rows.map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-2 text-xs">
            <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1 text-muted-foreground">{label}</span>
            <span className="font-mono font-semibold tabular-nums text-right text-foreground">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
