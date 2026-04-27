import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { ChartCard } from "./ChartCard";

interface Props {
  series: { session_index: number; count: number }[];
}

export function SubdomainGrowthChart({ series }: Props) {
  if (!series.length) return <ChartCard title="Subdomain Growth"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Subdomain Growth">
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={series} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <XAxis dataKey="session_index" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} width={40} />
          <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, borderRadius: "6px" }} />
          <Line type="monotone" dataKey="count" stroke="var(--primary)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
