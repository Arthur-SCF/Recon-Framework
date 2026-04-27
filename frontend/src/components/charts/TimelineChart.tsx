import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { STATUS_COLORS } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";
import type { DiffEvent } from "@/types/api";

interface TimelineChartProps {
  targetId: string;
}

interface BucketedPoint {
  date: string;
  discovered: number;
  changed: number;
  gone: number;
  returned: number;
}

export function TimelineChart({ targetId }: TimelineChartProps) {
  const [events, setEvents] = useState<DiffEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    void fetch(`/api/v1/targets/${targetId}/history?per_page=500`)
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((res: { data?: DiffEvent[] } | DiffEvent[]) => {
        // Backend now returns paginated shape { data: [...] }
        setEvents(Array.isArray(res) ? res : (res.data ?? []));
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [targetId]);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => {
    if (events.length === 0) return [];
    const buckets: Record<string, BucketedPoint> = {};
    for (const e of events) {
      const date = e.recorded_at.split("T")[0];
      if (!buckets[date]) {
        buckets[date] = { date, discovered: 0, changed: 0, gone: 0, returned: 0 };
      }
      buckets[date][e.event_type]++;
    }
    return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
  }, [events]);

  if (loading) {
    return (
      <ChartCard title="Discovery Timeline">
        <p className="py-8 text-center text-xs text-muted-foreground">Loading...</p>
      </ChartCard>
    );
  }

  if (data.length === 0) {
    return (
      <ChartCard title="Discovery Timeline">
        <p className="py-8 text-center text-xs text-muted-foreground">
          No history yet. Complete a scan to generate timeline data.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Discovery Timeline">
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--foreground)",
            }}
          />
          <Area
            type="monotone"
            dataKey="discovered"
            stackId="1"
            stroke={STATUS_COLORS["2xx"]}
            fill={STATUS_COLORS["2xx"]}
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="changed"
            stackId="1"
            stroke={STATUS_COLORS["3xx"]}
            fill={STATUS_COLORS["3xx"]}
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="gone"
            stackId="1"
            stroke={STATUS_COLORS["5xx"]}
            fill={STATUS_COLORS["5xx"]}
            fillOpacity={0.3}
          />
          <Area
            type="monotone"
            dataKey="returned"
            stackId="1"
            stroke={STATUS_COLORS["4xx"]}
            fill={STATUS_COLORS["4xx"]}
            fillOpacity={0.3}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
