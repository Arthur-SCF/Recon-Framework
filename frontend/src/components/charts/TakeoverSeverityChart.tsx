import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ChartCard } from "./ChartCard";

const SEV_COLORS: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#eab308", low: "#3b82f6", info: "#94a3b8",
};

interface Props {
  takeovers: { severity: string | null }[];
}

export function TakeoverSeverityChart({ takeovers }: Props) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of takeovers) {
      const s = t.severity || "info";
      counts[s] = (counts[s] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [takeovers]);

  if (!data.length) return <ChartCard title="Severity Distribution"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Severity Distribution">
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={35} outerRadius={60}>
            {data.map((d) => (
              <Cell key={d.name} fill={SEV_COLORS[d.name] || SEV_COLORS.info} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, borderRadius: "6px" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-1">
        {data.map((d) => (
          <span key={d.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: SEV_COLORS[d.name] || SEV_COLORS.info }} />
            {d.name} ({d.value})
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
