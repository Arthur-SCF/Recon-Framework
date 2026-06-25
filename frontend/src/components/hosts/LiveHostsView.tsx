import { useCallback, useEffect, useRef, useState } from "react";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import type { LiveHost, LiveHostStats, PaginatedResponse } from "@/types/api";
import { SkeletonRows } from "@/components/Skeleton";
import { LiveHostsTable } from "@/components/LiveHostsTable";
import { HostCardGrid } from "./HostCardGrid";
import { HostFilters } from "./HostFilters";
import { HostDetailPanel } from "./HostDetailPanel";
import { StatusCodeChart } from "@/components/charts/StatusCodeChart";
import { TechDistributionChart } from "@/components/charts/TechDistributionChart";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { LiveHostCol } from "@/components/LiveHostsTable";

interface LiveHostsViewProps {
  targetId: string;
}

const COL_TO_SORT_KEY: Record<string, string> = {
  code: "status_code",
  rt: "response_time",
};
const SORT_KEY_TO_COL: Record<string, string> = {
  status_code: "code",
  response_time: "rt",
};

const BUCKET_RANGES: Record<string, { gte: number; lte: number }> = {
  "2xx": { gte: 200, lte: 299 },
  "3xx": { gte: 300, lte: 399 },
  "4xx": { gte: 400, lte: 499 },
  "5xx": { gte: 500, lte: 599 },
};

export function LiveHostsView({ targetId }: LiveHostsViewProps) {
  const [schemeFilter,  setSchemeFilter]  = useState<"all" | "https" | "http">("all");
  const [statusFilter,  setStatusFilter]  = useState<string | null>(null);
  const [viewMode,      setViewMode]      = useState<"table" | "grid">("table");
  const [selectedHost,  setSelectedHost]  = useState<LiveHost | null>(null);
  const [page,          setPage]          = useState(0);
  const [hostStats,     setHostStats]     = useState<LiveHostStats | null>(null);

  useEffect(() => {
    setPage(0);
    setSelectedHost(null);
    setSchemeFilter("all");
    setStatusFilter(null);
  }, [targetId]);

  const schemeRef = useRef<"all" | "https" | "http">("all");
  const statusRef = useRef<string | null>(null);

  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/live-hosts`, window.location.origin);
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q) url.searchParams.set("q", params.q);
    if (params.sortBy) url.searchParams.set("sort_by", params.sortBy);
    url.searchParams.set("sort_dir", params.sortDir);
    if (schemeRef.current !== "all") url.searchParams.set("scheme", schemeRef.current);
    const bucket = statusRef.current;
    if (bucket && BUCKET_RANGES[bucket]) {
      url.searchParams.set("status_code_gte", String(BUCKET_RANGES[bucket].gte));
      url.searchParams.set("status_code_lte", String(BUCKET_RANGES[bucket].lte));
    }
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<LiveHost>>;
    });
  }, [targetId]);

  const hook = useServerPagination<LiveHost>(fetchFn, { perPage: 100 });

  const fetchStats = useCallback(() => {
    void fetch(`/api/v1/targets/${targetId}/live-hosts/stats`)
      .then((r) => (r.ok ? r.json() as Promise<LiveHostStats> : null))
      .then((s) => { if (s) setHostStats(s); })
      .catch(() => {});
  }, [targetId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    schemeRef.current = schemeFilter;
    hook.setPage(1);
    hook.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemeFilter]);

  useEffect(() => {
    statusRef.current = statusFilter;
    hook.setPage(1);
    hook.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useWsSubscribe("new_hosts", () => {
    hook.refresh();
    fetchStats();
  }, targetId);

  useEffect(() => {
    const interval = setInterval(() => hook.refresh(), 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hook.loading && hook.data.length === 0) {
    return <SkeletonRows count={8} />;
  }

  if (!hook.loading && hook.total === 0 && !hook.q && schemeFilter === "all" && !statusFilter) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No live hosts yet. Run a scan to discover them.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {hostStats && (
        <div className="grid gap-3 md:grid-cols-2">
          <StatusCodeChart
            stats={hostStats.by_status_code}
            activeBucket={statusFilter}
            onBucketClick={setStatusFilter}
          />
          <TechDistributionChart hosts={hook.data} />
        </div>
      )}

      <HostFilters
        filter={hook.q}
        onFilterChange={hook.setQ}
        schemeFilter={schemeFilter}
        onSchemeChange={setSchemeFilter}
        statusFilter={statusFilter}
        onStatusFilterClear={() => setStatusFilter(null)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filteredCount={hook.data.length}
        totalCount={hook.total}
        targetId={targetId}
      />

      {viewMode === "table" ? (
        <LiveHostsTable
          targetId={targetId}
          hosts={hook.data}
          onHostClick={setSelectedHost}
          onSort={(col, dir) => {
            if (col === null || dir === null) {
              hook.setSort("", "desc");
            } else {
              hook.setSort(COL_TO_SORT_KEY[col] ?? col, dir);
            }
          }}
          controlledSortBy={(hook.sortBy ? (SORT_KEY_TO_COL[hook.sortBy] ?? hook.sortBy) : hook.sortBy) as LiveHostCol | null}
          controlledSortDir={hook.sortDir}
        />
      ) : (
        <HostCardGrid
          hosts={hook.data}
          targetId={targetId}
          page={page}
          onPageChange={setPage}
          onHostClick={setSelectedHost}
        />
      )}

      {hook.total > hook.perPage && (
        <div className="flex items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
          <span>
            Page {hook.page} of {Math.ceil(hook.total / hook.perPage)} &mdash; {hook.total} hosts
          </span>
          <div className="flex gap-1">
            <button
              className="rounded border border-border px-2 py-1 text-xs enabled:hover:bg-accent disabled:opacity-40"
              disabled={hook.page <= 1}
              onClick={() => hook.setPage(1)}
            >
              «
            </button>
            <button
              className="rounded border border-border px-2 py-1 text-xs enabled:hover:bg-accent disabled:opacity-40"
              disabled={hook.page <= 1}
              onClick={() => hook.setPage(hook.page - 1)}
            >
              ‹
            </button>
            <button
              className="rounded border border-border px-2 py-1 text-xs enabled:hover:bg-accent disabled:opacity-40"
              disabled={hook.page >= Math.ceil(hook.total / hook.perPage)}
              onClick={() => hook.setPage(hook.page + 1)}
            >
              ›
            </button>
            <button
              className="rounded border border-border px-2 py-1 text-xs enabled:hover:bg-accent disabled:opacity-40"
              disabled={hook.page >= Math.ceil(hook.total / hook.perPage)}
              onClick={() => hook.setPage(Math.ceil(hook.total / hook.perPage))}
            >
              »
            </button>
          </div>
        </div>
      )}

      {selectedHost && (
        <HostDetailPanel
          host={selectedHost}
          targetId={targetId}
          onClose={() => setSelectedHost(null)}
        />
      )}
    </div>
  );
}
