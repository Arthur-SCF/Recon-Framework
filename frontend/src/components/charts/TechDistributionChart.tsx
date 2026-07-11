import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { LiveHost } from "@/types/api";
import { TECH_PALETTE, useChartColors } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";

interface TechDistributionChartProps {
  hosts: LiveHost[];
}

export function TechDistributionChart({ hosts }: TechDistributionChartProps) {
  const colors = useChartColors();
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of hosts) {
      for (const t of h.tech ?? []) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [hosts]);

  if (data.length === 0) {
    return (
      <ChartCard title="Top Technologies">
        <p className="py-8 text-center text-xs text-muted-foreground">No data</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Top Technologies">
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 28)}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="name"
            width={100}
            tick={{ fontSize: 11, fill: colors.muted }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: colors.card,
              border: `1px solid ${colors.border}`,
              borderRadius: "6px",
              fontSize: "12px",
              color: colors.foreground,
            }}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
            {data.map((_, i) => (
              <Cell key={i} fill={TECH_PALETTE[i % TECH_PALETTE.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
