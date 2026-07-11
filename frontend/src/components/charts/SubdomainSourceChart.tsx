import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import { TECH_PALETTE, useChartColors } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";

interface Props {
  stats: { source: string; count: number }[];
}

export function SubdomainSourceChart({ stats }: Props) {
  const colors = useChartColors();
  const data = useMemo(
    () => [...stats].sort((a, b) => b.count - a.count).slice(0, 10),
    [stats],
  );

  if (!data.length) return <ChartCard title="Subdomain Sources"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Subdomain Sources">
      <ResponsiveContainer width="100%" height={data.length * 28 + 20}>
        <BarChart data={data} layout="vertical" margin={{ left: 80, right: 12, top: 4, bottom: 4 }}>
          <XAxis type="number" hide domain={[0, "dataMax"]} />
          <YAxis type="category" dataKey="source" tick={{ fontSize: 11, fill: colors.muted }} width={75} />
          <Tooltip
            contentStyle={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, color: colors.foreground, fontSize: 12, borderRadius: "6px" }}
          />
          <Bar dataKey="count" fill={TECH_PALETTE[0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
