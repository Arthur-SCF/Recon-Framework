import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useChartColors } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";

interface Props {
  series: { session_index: number; count: number }[];
}

export function SubdomainGrowthChart({ series }: Props) {
  const colors = useChartColors();
  if (!series.length) return <ChartCard title="Subdomain Growth"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Subdomain Growth">
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={series} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <XAxis dataKey="session_index" tick={{ fontSize: 10, fill: colors.muted }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: colors.muted }} width={40} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ backgroundColor: colors.card, border: `1px solid ${colors.border}`, color: colors.foreground, fontSize: 12, borderRadius: "6px" }} />
          <Line type="monotone" dataKey="count" stroke={colors.primary} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
