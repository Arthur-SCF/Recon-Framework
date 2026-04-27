import { useMemo } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { LiveHost } from "@/types/api";
import { STATUS_COLORS } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";

interface StatusCodeChartProps {
  hosts: LiveHost[];
}

function bucketLabel(code: number): string {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500) return "5xx";
  return "other";
}

export function StatusCodeChart({ hosts }: StatusCodeChartProps) {
  const data = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of hosts) {
      const bucket = h.status_code ? bucketLabel(h.status_code) : "other";
      counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [hosts]);

  if (data.length === 0) {
    return (
      <ChartCard title="Status Codes">
        <p className="py-8 text-center text-xs text-muted-foreground">No data</p>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Status Codes">
      <div className="flex items-center gap-4">
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={STATUS_COLORS[entry.name] ?? STATUS_COLORS.other}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "6px",
                fontSize: "12px",
                color: "var(--foreground)",
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex flex-col gap-1.5">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: STATUS_COLORS[d.name] ?? STATUS_COLORS.other }}
              />
              <span className="text-muted-foreground">{d.name}</span>
              <span className="font-medium text-foreground">{d.value}</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
