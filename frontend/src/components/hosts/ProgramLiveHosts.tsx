import { useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { InlineError } from "@/components/ui/InlineError";
import { LiveHostsTable, type LiveHostCol } from "@/components/LiveHostsTable";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { LiveHost, PaginatedResponse } from "@/types/api";

const COL_TO_SORT_KEY: Record<string, string> = {
  code: "status_code",
  rt: "response_time",
};
const SORT_KEY_TO_COL: Record<string, string> = {
  status_code: "code",
  response_time: "rt",
};

export function ProgramLiveHosts({ programId }: { programId: string }) {
  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/programs/${programId}/live-hosts`, window.location.origin);
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q)      url.searchParams.set("q",        params.q);
    if (params.sortBy) url.searchParams.set("sort_by",  params.sortBy);
    url.searchParams.set("sort_dir", params.sortDir);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<LiveHost>>;
    });
  }, [programId]);

  const hook = useServerPagination<LiveHost>(fetchFn, { perPage: 100 });
  const totalPages = Math.ceil(hook.total / hook.perPage);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hook.q}
          onChange={(e) => hook.setQ(e.target.value)}
          placeholder="Filter by URL, title, webserver…"
          className="h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-64"
        />
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {hook.total.toLocaleString()} host{hook.total !== 1 ? "s" : ""}
        </span>
        <button
          onClick={hook.refresh}
          className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Refresh
        </button>
      </div>

      {hook.error && !hook.loading && (
        <InlineError message={hook.error} onRetry={hook.refresh} />
      )}

      {hook.loading && hook.data.length === 0 ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hook.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {hook.total === 0 ? "No live hosts across this program yet." : "No results match the current filter."}
        </p>
      ) : (
        <LiveHostsTable
          targetId=""
          hosts={hook.data}
          showAsset
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
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            Showing {(hook.page - 1) * hook.perPage + 1}–{Math.min(hook.page * hook.perPage, hook.total)} of {hook.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => hook.setPage(hook.page - 1)} disabled={hook.page <= 1}
              className="rounded-md p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-mono tabular-nums">{hook.page} / {totalPages}</span>
            <button onClick={() => hook.setPage(hook.page + 1)} disabled={hook.page >= totalPages}
              className="rounded-md p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
