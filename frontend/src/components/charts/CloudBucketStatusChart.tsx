import { useMemo } from "react";
import { ChartCard } from "./ChartCard";

interface Bucket {
  bucket_exists?: boolean | number;
  public_read?: boolean | number;
  public_write?: boolean | number;
}

interface Props {
  buckets: Bucket[];
}

export function CloudBucketStatusChart({ buckets }: Props) {
  const stats = useMemo(() => {
    let exists = 0, publicRead = 0, publicWrite = 0;
    for (const b of buckets) {
      if (b.bucket_exists) exists++;
      if (b.public_read) publicRead++;
      if (b.public_write) publicWrite++;
    }
    return { total: buckets.length, exists, publicRead, publicWrite };
  }, [buckets]);

  if (!stats.total) return null;

  const tiles = [
    { label: "Total", value: stats.total, color: "text-foreground" },
    { label: "Exists", value: stats.exists, color: "text-primary" },
    { label: "Public Read", value: stats.publicRead, color: stats.publicRead > 0 ? "text-destructive" : "text-muted-foreground" },
    { label: "Public Write", value: stats.publicWrite, color: stats.publicWrite > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <ChartCard title="S3 Bucket Summary">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="text-center">
            <div className={`text-lg font-semibold ${t.color}`}>{t.value}</div>
            <div className="text-[10px] text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
