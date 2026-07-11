import { useEffect, useState } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { TrendingUp, Monitor, Activity } from "lucide-react";
import { ChartCard } from "@/components/charts/ChartCard";
import { useChartColors, TECH_PALETTE, STATUS_COLORS } from "@/lib/chartTheme";

interface StatsOverview {
  totals: {
    targets: number;
    running_scans: number;
    subdomains: number;
    hosts: number;
  };
  recent_7d: {
    new_subdomains: number;
    new_hosts: number;
    hosts_gone: number;
    new_takeovers: number;
  };
  growth_series: {
    session_id: string;
    target_id: string;
    started_at: string;
    subdomain_count: number;
  }[];
  top_tech: { tech: string; count: number }[];
  status_dist: { status_code: number; count: number }[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusBucket(code: number): string {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500) return "5xx";
  return "other";
}

function SkeletonPanel() {
  return <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />;
}

export function DashboardCharts() {
  const [data, setData] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  useEffect(() => {
    let cancelled = false;
    const doFetch = () => {
      setError(null);
      fetch("/api/v1/stats/overview")
        .then((r) => r.ok ? r.json() as Promise<StatsOverview> : Promise.reject())
        .then((d) => { if (!cancelled) { setData(d); setError(null); setLoading(false); } })
        .catch(() => { if (!cancelled) { setError("Failed to load stats"); setLoading(false); } });
    };
    doFetch();
    const interval = setInterval(doFetch, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (loading) {
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        <SkeletonPanel />
        <SkeletonPanel />
        <SkeletonPanel />
      </div>
    );
  }

  if (!loading && (error || !data)) {
    return (
      <div className="grid gap-3 lg:grid-cols-3">
        {["Attack Surface Growth", "Technology Fingerprint", "HTTP Status Distribution"].map((title) => (
          <ChartCard key={title} title={title}>
            <div className="flex h-36 flex-col items-center justify-center gap-1.5 text-muted-foreground/40">
              <Activity className="h-5 w-5" />
              <p className="text-xs">Chart unavailable</p>
            </div>
          </ChartCard>
        ))}
      </div>
    );
  }

  if (!data) return null;

  // ── Growth chart data ──────────────────────────────────────────────────────
  const growthData = data.growth_series.map((s) => ({
    date: formatDate(s.started_at),
    subdomains: s.subdomain_count,
  }));

  // ── Tech bar data (top 10) ─────────────────────────────────────────────────
  const techData = data.top_tech.slice(0, 10).map((t) => ({
    name: t.tech.length > 18 ? t.tech.slice(0, 18) + "…" : t.tech,
    count: t.count,
  }));

  // ── Status dist: bucket and merge ──────────────────────────────────────────
  const buckets: Record<string, number> = {};
  for (const s of data.status_dist) {
    const b = statusBucket(s.status_code);
    buckets[b] = (buckets[b] ?? 0) + s.count;
  }

  const { recent_7d } = data;

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {/* Panel 1 — Attack Surface Growth */}
      <ChartCard title="Attack Surface Growth">
        {growthData.length === 0 ? (
          <div className="flex h-36 items-center justify-center">
            <div className="flex flex-col items-center gap-1 text-center">
              <TrendingUp className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">
                Run a scan to see growth over time
              </p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={144}>
            <LineChart data={growthData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{
                  background: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "6px",
                  fontSize: 11,
                  color: colors.foreground,
                }}
                formatter={(v) => [Number(v).toLocaleString(), "subdomains"]}
                labelStyle={{ color: colors.muted }}
              />
              <Line
                type="monotone"
                dataKey="subdomains"
                stroke={colors.primary}
                strokeWidth={2}
                dot={growthData.length <= 8}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Panel 2 — Technology Distribution */}
      <ChartCard title="Top Technologies">
        {techData.length === 0 ? (
          <div className="flex h-36 items-center justify-center">
            <div className="flex flex-col items-center gap-1 text-center">
              <Monitor className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No tech data yet</p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={144}>
            <BarChart
              data={techData}
              layout="vertical"
              margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={72}
                tick={{ fontSize: 10, fill: colors.muted }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: colors.card,
                  border: `1px solid ${colors.border}`,
                  borderRadius: "6px",
                  fontSize: 11,
                  color: colors.foreground,
                }}
                formatter={(v) => [Number(v).toLocaleString(), "hosts"]}
                cursor={{ fill: "transparent" }}
              />
              <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                {techData.map((_, i) => (
                  <Cell key={i} fill={TECH_PALETTE[i % TECH_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Panel 3 — Recent Activity (last 7 days) */}
      <ChartCard title="Last 7 Days">
        <div className="flex h-36 flex-col justify-center gap-3">
          {Object.values(recent_7d).every((v) => v === 0) ? (
            <div className="flex flex-col items-center gap-1 text-center">
              <Activity className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No activity this week</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <ActivityTile
                value={recent_7d.new_subdomains}
                label="new subdomains"
                color="text-sev-low"
                sign="+"
              />
              <ActivityTile
                value={recent_7d.new_hosts}
                label="new hosts"
                color="text-sev-info"
                sign="+"
              />
              <ActivityTile
                value={recent_7d.hosts_gone}
                label="hosts gone"
                color="text-sev-medium"
                sign=""
              />
              <ActivityTile
                value={recent_7d.new_takeovers}
                label="takeover candidates"
                color={recent_7d.new_takeovers > 0 ? "text-sev-critical" : "text-muted-foreground"}
                sign=""
              />
            </div>
          )}

          {/* Status distribution mini-row */}
          {Object.keys(buckets).length > 0 && (
            <div className="flex items-center gap-1 pt-1 border-t border-border">
              {(["2xx","3xx","4xx","5xx"] as const).map((b) =>
                buckets[b] ? (
                  <span
                    key={b}
                    className="rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums"
                    style={{ background: STATUS_COLORS[b] + "22", color: STATUS_COLORS[b] }}
                  >
                    {b} · {buckets[b].toLocaleString()}
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>
      </ChartCard>
    </div>
  );
}

function ActivityTile({
  value, label, color, sign,
}: {
  value: number;
  label: string;
  color: string;
  sign: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2.5 py-2">
      <p className={`font-mono text-lg font-semibold leading-none tabular-nums ${color}`}>
        {sign}{value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
