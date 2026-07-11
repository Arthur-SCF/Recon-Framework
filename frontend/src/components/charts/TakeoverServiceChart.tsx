import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TECH_PALETTE, useChartColors } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";

interface Props {
  takeovers: { service?: string; template_id?: string }[];
}

export function TakeoverServiceChart({ takeovers }: Props) {
  const colors = useChartColors();
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of takeovers) {
      const svc = t.service || t.template_id || "unknown";
      counts[svc] = (counts[svc] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [takeovers]);

  if (!data.length) return <ChartCard title="Takeover by Service"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Takeover by Service">
      <ResponsiveContainer width="100%" height={data.length * 28 + 20}>
        <BarChart data={data} layout="vertical" margin={{ left: 90, right: 12, top: 4, bottom: 4 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: colors.muted }} width={85} />
          <Tooltip contentStyle={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, color: colors.foreground, fontSize: 12, borderRadius: "6px" }} />
          <Bar dataKey="value" fill={TECH_PALETTE[1]} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
