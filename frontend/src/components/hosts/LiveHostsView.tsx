import { useCallback, useEffect, useRef, useState } from "react";
import { useWsSubscribe } from "@/hooks/useWebSocket";
import type { LiveHost } from "@/types/api";
import type { PaginatedResponse } from "@/types/api";
import { SkeletonRows } from "@/components/Skeleton";
import { LiveHostsTable } from "@/components/LiveHostsTable";
import { HostCardGrid } from "./HostCardGrid";
import { HostFilters } from "./HostFilters";
import { HostDetailPanel } from "./HostDetailPanel";
import { StatusCodeChart } from "@/components/charts/StatusCodeChart";
import { TechDistributionChart } from "@/components/charts/TechDistributionChart";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";

interface LiveHostsViewProps {
  targetId: string;
}

export function LiveHostsView({ targetId }: LiveHostsViewProps) {
  const [schemeFilter, setSchemeFilter] = useState<"all" | "https" | "http">("all");
  const [viewMode,     setViewMode]     = useState<"table" | "grid">("table");
  const [selectedHost, setSelectedHost] = useState<LiveHost | null>(null);
  const [page,         setPage]         = useState(0); // grid page (0-based)

  // Reset local state when target changes
  useEffect(() => {
    setPage(0);
    setSelectedHost(null);
    setSchemeFilter("all");
  }, [targetId]);

  // Ref so fetchFn stays stable while still seeing current scheme
  const schemeRef = useRef<"all" | "https" | "http">("all");

  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/live-hosts`, window.location.origin);
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q) url.searchParams.set("q", params.q);
    if (params.sortBy) url.searchParams.set("sort_by", params.sortBy);
    url.searchParams.set("sort_dir", params.sortDir);
    if (schemeRef.current !== "all") url.searchParams.set("scheme", schemeRef.current);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<LiveHost>>;
    });
  }, [targetId]);

  const hook = useServerPagination<LiveHost>(fetchFn, { perPage: 100 });

  // When scheme changes: update ref then force a re-fetch
  useEffect(() => {
    schemeRef.current = schemeFilter;
    hook.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemeFilter]);

  // WebSocket: refresh on new_hosts events for this target
  useWsSubscribe("new_hosts", () => hook.refresh(), targetId);

  // 30s fallback stale-data safety net
  useEffect(() => {
    const interval = setInterval(() => hook.refresh(), 30_000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hook.loading && hook.data.length === 0) {
    return <SkeletonRows count={8} />;
  }

  if (!hook.loading && hook.total === 0 && !hook.q && schemeFilter === "all") {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No live hosts yet. Run a scan to discover them.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Charts — use current page data */}
      {hook.data.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          <StatusCodeChart hosts={hook.data} />
          <TechDistributionChart hosts={hook.data} />
        </div>
      )}

      <HostFilters
        filter={hook.q}
        onFilterChange={hook.setQ}
        schemeFilter={schemeFilter}
        onSchemeChange={setSchemeFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filteredCount={hook.data.length}
        totalCount={hook.total}
        targetId={targetId}
      />

      {viewMode === "table" ? (
        <LiveHostsTable targetId={targetId} hosts={hook.data} onHostClick={setSelectedHost} />
      ) : (
        <HostCardGrid
          hosts={hook.data}
          targetId={targetId}
          page={page}
          onPageChange={setPage}
          onHostClick={setSelectedHost}
        />
      )}

      {/* Pagination bar */}
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
