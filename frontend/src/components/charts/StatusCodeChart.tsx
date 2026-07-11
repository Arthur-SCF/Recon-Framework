import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { STATUS_COLORS } from "@/lib/chartTheme";
import { ChartCard } from "./ChartCard";
import { cn } from "@/lib/utils";

interface Props {
  stats: Record<string, number>;
  activeBucket?: string | null;
  onBucketClick?: (bucket: string | null) => void;
}

export function StatusCodeChart({ stats, activeBucket, onBucketClick }: Props) {
  const data = Object.entries(stats)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

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
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onClick={onBucketClick ? (entry: any) => {
                const bucket = String(entry?.name ?? "");
                if (bucket) onBucketClick(bucket === activeBucket ? null : bucket);
              } : undefined}
              style={onBucketClick ? { cursor: "pointer" } : undefined}
            >
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={STATUS_COLORS[entry.name] ?? STATUS_COLORS.other}
                  opacity={activeBucket && activeBucket !== entry.name ? 0.4 : 1}
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

        <div className="flex flex-col gap-1.5">
          {data.map((d) => (
            <button
              key={d.name}
              onClick={onBucketClick ? () => onBucketClick(d.name === activeBucket ? null : d.name) : undefined}
              disabled={!onBucketClick}
              className={cn(
                "flex items-center gap-2 text-xs text-left transition-opacity",
                onBucketClick && "hover:opacity-100 cursor-pointer",
                activeBucket && activeBucket !== d.name && "opacity-40",
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: STATUS_COLORS[d.name] ?? STATUS_COLORS.other }}
              />
              <span className={cn("font-mono text-muted-foreground", activeBucket === d.name && "text-foreground font-medium")}>
                {d.name}
              </span>
              <span className="font-mono font-semibold tabular-nums text-foreground">{d.value}</span>
            </button>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
