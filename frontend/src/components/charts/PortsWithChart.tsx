import { useEffect, useState } from "react";
import { PortsTable } from "@/components/PortsTable";
import { PortHistogram } from "./PortHistogram";

interface PortEntry {
  host: string;
  port: number;
  protocol: string;
  standard: boolean;
  subdomains: string[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}

interface PortsWithChartProps {
  targetId: string;
}

export function PortsWithChart({ targetId }: PortsWithChartProps) {
  const [ports, setPorts] = useState<PortEntry[]>([]);

  // Separate lightweight fetch for chart data only (per_page=10000)
  useEffect(() => {
    void fetch(`/api/v1/targets/${targetId}/ports?per_page=10000`)
      .then((r) => (r.ok ? (r.json() as Promise<PaginatedResponse<PortEntry>>) : Promise.reject()))
      .then((res) => setPorts(res.data))
      .catch(() => setPorts([]));
  }, [targetId]);

  return (
    <div className="flex flex-col gap-3">
      {ports.length > 0 && <PortHistogram ports={ports} />}
      <PortsTable targetId={targetId} />
    </div>
  );
}
