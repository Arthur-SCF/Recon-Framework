import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ExternalLink, ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/ExportMenu";
import { InlineError } from "@/components/ui/InlineError";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { PaginatedResponse } from "@/types/api";
import { SubdomainSourceChart } from "@/components/charts/SubdomainSourceChart";
import { useWsSubscribe } from "@/hooks/useWebSocket";

type SortDir = "asc" | "desc" | null;

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === "asc")  return <ArrowUp   className="h-3 w-3" />;
  if (dir === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" />;
}

interface Subdomain {
  id: string;
  subdomain: string;
  sources: string[] | null;
  first_seen: string;
  last_seen: string;
  is_live: boolean;
  consolidated_in: string[] | null;
  target_id?: string;
  asset_domain?: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface SubdomainsTableProps {
  targetId?: string;
  /** Override the endpoint base; defaults to /targets/${targetId}. Program views pass /programs/${id}. */
  endpointBase?: string;
  /** Render an extra "Asset" column bound to row.asset_domain (program-aggregated view). */
  showAsset?: boolean;
}

export function SubdomainsTable({ targetId, endpointBase, showAsset = false }: SubdomainsTableProps) {
  const base = endpointBase ?? `/targets/${targetId}`;
  const [stats, setStats] = useState<{ source: string; count: number }[]>([]);

  useEffect(() => {
    if (showAsset || !targetId) return;
    fetch(`/api/v1/targets/${targetId}/subdomains/stats`)
      .then((r) => r.json())
      .then((d) => setStats(
        Object.entries(d.by_source ?? {}).map(([source, count]) => ({ source, count: count as number }))
      ))
      .catch(() => {});
  }, [targetId, showAsset]);

  const fetchFn = useCallback(
    (params: PaginationParams) => {
      const url = new URL(`/api/v1${base}/subdomains`, window.location.origin);
      url.searchParams.set("page",     String(params.page));
      url.searchParams.set("per_page", String(params.perPage));
      if (params.q)      url.searchParams.set("q",        params.q);
      if (params.sortBy) url.searchParams.set("sort_by",  params.sortBy);
      url.searchParams.set("sort_dir", params.sortDir);
      return fetch(url.toString()).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<PaginatedResponse<Subdomain>>;
      });
    },
    [targetId],
  );

  const hook = useServerPagination<Subdomain>(fetchFn, { sortBy: "first_seen", sortDir: "desc" });

  useWsSubscribe(["step_completed"], () => { hook.refresh(); }, targetId);

  useEffect(() => {
    const interval = setInterval(() => hook.refresh(), 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(col: string) {
    if (hook.sortBy === col) {
      hook.setSort(col, hook.sortDir === "asc" ? "desc" : "asc");
    } else {
      hook.setSort(col, "desc");
    }
  }

  const totalPages = Math.ceil(hook.total / hook.perPage);

  return (
    <div className="flex flex-col gap-3">
      {/* Charts */}
      {stats.length > 0 && (
        <div className="mb-3">
          <SubdomainSourceChart stats={stats} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Filter subdomains…"
          value={hook.q}
          onChange={(e) => hook.setQ(e.target.value)}
          className="h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-56"
        />
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {hook.total.toLocaleString()} subdomains
        </span>
        <button
          onClick={hook.refresh}
          className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Refresh
        </button>
        {!showAsset && targetId && <ExportMenu targetId={targetId} type="subdomains" />}
      </div>

      {hook.error && !hook.loading && (
        <InlineError message={hook.error} onRetry={hook.refresh} />
      )}

      {/* Table */}
      {hook.loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : hook.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {hook.total === 0
            ? "No subdomains yet — run a scan first."
            : "No results match the current filter."}
        </p>
      ) : (
        <>
          {/* Mobile card view */}
          <div className="sm:hidden flex flex-col gap-2">
            {hook.data.map((row) => (
              <div key={row.id} className="rounded-lg border border-border bg-card p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-foreground truncate flex-1">{row.subdomain}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {row.is_live && <span className="rounded bg-sev-low/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sev-low">live</span>}
                    <a href={`https://${row.subdomain}`} target="_blank" rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
                {showAsset && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Asset:{" "}
                    {row.target_id ? (
                      <Link to={`/target/${row.target_id}`} className="font-mono text-primary hover:underline">
                        {row.asset_domain ?? "—"}
                      </Link>
                    ) : (
                      <span className="font-mono">{row.asset_domain ?? "—"}</span>
                    )}
                  </p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(row.sources ?? []).map((src) => (
                    <span key={src} className="rounded px-1 py-0.5 text-[10px] bg-primary/10 text-primary border border-primary/20">{src}</span>
                  ))}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  First seen {relativeTime(row.first_seen)} · Last seen {relativeTime(row.last_seen)}
                </p>
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("subdomain")}>
                    <span className="inline-flex items-center gap-1">Subdomain <SortIcon dir={hook.sortBy === "subdomain" ? hook.sortDir : null} /></span>
                  </th>
                  {showAsset && <th className="px-3 py-2">Asset</th>}
                  <th className="px-3 py-2">Sources</th>
                  <th className="px-3 py-2">Round</th>
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("is_live")}>
                    <span className="inline-flex items-center gap-1">Live <SortIcon dir={hook.sortBy === "is_live" ? hook.sortDir : null} /></span>
                  </th>
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("first_seen")}>
                    <span className="inline-flex items-center gap-1">First seen <SortIcon dir={hook.sortBy === "first_seen" ? hook.sortDir : null} /></span>
                  </th>
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("last_seen")}>
                    <span className="inline-flex items-center gap-1">Last seen <SortIcon dir={hook.sortBy === "last_seen" ? hook.sortDir : null} /></span>
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {hook.data.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-border last:border-0",
                      i % 2 === 0 ? "bg-background" : "bg-muted/10",
                      "hover:bg-surface-hover transition-colors",
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono text-foreground">{row.subdomain}</td>
                    {showAsset && (
                      <td className="px-3 py-1.5">
                        {row.target_id ? (
                          <Link to={`/target/${row.target_id}`} className="font-mono text-primary hover:underline">
                            {row.asset_domain ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-mono text-muted-foreground">{row.asset_domain ?? "—"}</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <div className="flex flex-wrap gap-1">
                        {(row.sources ?? []).map((src) => (
                          <span
                            key={src}
                            className="rounded px-1 py-0.5 text-[10px] bg-primary/10 text-primary border border-primary/20"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {(row.consolidated_in ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {row.is_live ? (
                        <span className="rounded bg-sev-low/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-sev-low">live</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{relativeTime(row.first_seen)}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-muted-foreground">{relativeTime(row.last_seen)}</td>
                    <td className="px-3 py-1.5">
                      <a
                        href={`https://${row.subdomain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                Showing {(hook.page - 1) * hook.perPage + 1}–{Math.min(hook.page * hook.perPage, hook.total)} of {hook.total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => hook.setPage(hook.page - 1)}
                  disabled={hook.page <= 1}
                  className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-2 font-mono tabular-nums">{hook.page} / {totalPages}</span>
                <button
                  onClick={() => hook.setPage(hook.page + 1)}
                  disabled={hook.page >= totalPages}
                  className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
