import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "./ChartCard";

interface PortEntry {
  host: string;
  port: number;
  protocol: string;
  standard: boolean;
  subdomains: string[];
}

interface PortHistogramProps {
  ports: PortEntry[];
}

export function PortHistogram({ ports }: PortHistogramProps) {
  const data = useMemo(() => {
    // Aggregate by port/protocol, counting distinct hosts
    const buckets: Record<string, { port: number; protocol: string; count: number }> = {};
    for (const p of ports) {
      const key = `${p.port}/${p.protocol}`;
      if (!buckets[key]) {
        buckets[key] = { port: p.port, protocol: p.protocol, count: 0 };
      }
      buckets[key].count++;
    }
    return Object.values(buckets)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)
      .map((b) => ({
        name: `${b.port}/${b.protocol}`,
        count: b.count,
      }));
  }, [ports]);

  if (data.length === 0) {
    return (
      <ChartCard title="Port Distribution">
        <p className="py-8 text-center text-xs text-muted-foreground">No data</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Port Distribution">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ left: 0, right: 12, top: 4, bottom: 0 }}>
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={50}
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
            formatter={(value) => [`${value} hosts`, "Count"]}
          />
          <Bar dataKey="count" fill="#60a5fa" radius={[4, 4, 0, 0]} barSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
