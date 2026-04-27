import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { ChartCard } from "./ChartCard";

const PROVIDER_COLORS: Record<string, string> = {
  s3: "#f97316", azure: "#3b82f6", gcp: "#22c55e", generic: "#94a3b8",
};

interface Props {
  assets: { provider: string }[];
}

export function CloudProviderChart({ assets }: Props) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of assets) {
      const p = a.provider || "generic";
      counts[p] = (counts[p] || 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [assets]);

  if (!data.length) return <ChartCard title="Cloud Providers"><p className="text-xs text-muted-foreground">No data</p></ChartCard>;

  return (
    <ChartCard title="Cloud Providers">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={30} outerRadius={55}>
            {data.map((d) => (
              <Cell key={d.name} fill={PROVIDER_COLORS[d.name] || PROVIDER_COLORS.generic} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ backgroundColor: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, borderRadius: "6px" }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-2 mt-1">
        {data.map((d) => (
          <span key={d.name} className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: PROVIDER_COLORS[d.name] || PROVIDER_COLORS.generic }} />
            {d.name} ({d.value})
          </span>
        ))}
      </div>
    </ChartCard>
  );
}
