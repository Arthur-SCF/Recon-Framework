import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, Check, X, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/ui/InlineError";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { PaginatedResponse } from "@/types/api";
import { ExportMenu } from "./ExportMenu";
import { TakeoverSeverityChart } from "@/components/charts/TakeoverSeverityChart";
import { TakeoverServiceChart } from "@/components/charts/TakeoverServiceChart";
import { useWsSubscribe } from "@/hooks/useWebSocket";

type SortDir = "asc" | "desc" | null;

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === "asc")  return <ArrowUp   className="h-3 w-3" />;
  if (dir === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" />;
}

interface TakeoverCandidate {
  id: string;
  target_id: string;
  session_id: string | null;
  subdomain: string;
  url: string | null;
  template_id: string | null;
  service: string | null;
  severity: string | null;
  matched_at: string | null;
  verified: number;
  asset_domain?: string;
}

interface Props {
  targetId?: string;
  /** Override the endpoint base; defaults to /targets/${targetId}. Program views pass /programs/${id}. */
  endpointBase?: string;
  /** Render an extra "Asset" column bound to row.asset_domain (program-aggregated view). */
  showAsset?: boolean;
}

const SEVERITY_CLASS: Record<string, string> = {
  critical: "bg-sev-critical/15 text-sev-critical",
  high:     "bg-sev-high/15 text-sev-high",
  medium:   "bg-sev-medium/15 text-sev-medium",
  low:      "bg-sev-low/15 text-sev-low",
  info:     "bg-sev-info/15 text-sev-info",
};

function SeverityBadge({ severity }: { severity: string | null }) {
  const sev = (severity || "info").toLowerCase();
  return (
    <span className={cn(
      "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide",
      SEVERITY_CLASS[sev] ?? SEVERITY_CLASS.info,
    )}>
      {sev}
    </span>
  );
}

function StatusBadge({ verified }: { verified: number }) {
  if (verified === 1) {
    return <span className="inline-flex items-center gap-1 rounded bg-sev-critical/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-sev-critical"><Check className="h-2.5 w-2.5" /> Verified</span>;
  }
  if (verified === -1) {
    return <span className="inline-flex items-center gap-1 rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground"><X className="h-2.5 w-2.5" /> False Positive</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded bg-sev-medium/15 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-sev-medium"><AlertTriangle className="h-2.5 w-2.5" /> Unverified</span>;
}

export function TakeoverTable({ targetId, endpointBase, showAsset = false }: Props) {
  const base = endpointBase ?? `/targets/${targetId}`;
  const [updating, setUpdating] = useState<string | null>(null);

  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1${base}/takeovers`, window.location.origin);
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q)      url.searchParams.set("q",       params.q);
    if (params.sortBy) url.searchParams.set("sort_by", params.sortBy);
    url.searchParams.set("sort_dir", params.sortDir);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<TakeoverCandidate>>;
    });
  }, [base]);

  const hook = useServerPagination<TakeoverCandidate>(fetchFn, { sortBy: "severity", sortDir: "desc" });

  useWsSubscribe(["step_completed"], () => hook.refresh(), targetId);

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

  const setVerified = useCallback(async (id: string, value: number) => {
    setUpdating(id);
    try {
      const resp = await fetch(`/api/v1/targets/${targetId}/takeovers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified: value }),
      });
      if (resp.ok) hook.refresh();
    } finally {
      setUpdating(null);
    }
  }, [targetId, hook]);

  const totalPages = Math.ceil(hook.total / hook.perPage);

  if (!hook.loading && hook.total === 0 && !hook.q) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
        <ShieldAlert className="h-8 w-8 opacity-30" />
        <span>No takeover candidates detected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Charts */}
      {hook.data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <TakeoverSeverityChart takeovers={hook.data} />
          <TakeoverServiceChart takeovers={hook.data as { service?: string; template_id?: string }[]} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hook.q}
          onChange={(e) => hook.setQ(e.target.value)}
          placeholder="Filter by subdomain…"
          className="h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-56"
        />
        <div className="flex items-center gap-2 ml-auto">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {hook.total} candidate{hook.total !== 1 ? "s" : ""}
          </span>
          <button
            onClick={hook.refresh}
            className="h-8 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Refresh
          </button>
          {!showAsset && targetId && <ExportMenu targetId={targetId} type="takeovers" />}
        </div>
      </div>

      {hook.error && !hook.loading && (
        <InlineError message={hook.error} onRetry={hook.refresh} />
      )}

      {hook.loading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Loading…</div>
      ) : hook.data.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No results match the current filter.</div>
      ) : (
        <>
          {/* Mobile card view */}
          <div className="sm:hidden flex flex-col gap-2">
            {hook.data.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <SeverityBadge severity={c.severity} />
                  <StatusBadge verified={c.verified} />
                </div>
                <p className="mt-2 font-mono text-xs text-foreground break-all">{c.subdomain}</p>
                {showAsset && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Asset:{" "}
                    {c.target_id ? (
                      <Link to={`/target/${c.target_id}`} className="font-mono text-primary hover:underline">
                        {c.asset_domain ?? "—"}
                      </Link>
                    ) : (
                      <span className="font-mono">{c.asset_domain ?? "—"}</span>
                    )}
                  </p>
                )}
                {(c.service || c.template_id) && (
                  <p className="mt-1 text-[10px] text-muted-foreground">{c.service || c.template_id}</p>
                )}
                {(c.matched_at || c.url) && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground truncate">{c.matched_at || c.url}</p>
                )}
                {!showAsset && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.verified !== 1 && (
                      <button onClick={() => void setVerified(c.id, 1)} disabled={updating === c.id}
                        className="rounded border border-sev-critical/40 bg-sev-critical/10 px-2 py-0.5 text-[11px] text-sev-critical hover:bg-sev-critical/20 transition-colors disabled:opacity-50">
                        Confirm
                      </button>
                    )}
                    {c.verified !== -1 && (
                      <button onClick={() => void setVerified(c.id, -1)} disabled={updating === c.id}
                        className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                        False Positive
                      </button>
                    )}
                    {c.verified !== 0 && (
                      <button onClick={() => void setVerified(c.id, 0)} disabled={updating === c.id}
                        className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                        Reset
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("severity")}>
                    <span className="inline-flex items-center gap-1">Severity <SortIcon dir={hook.sortBy === "severity" ? hook.sortDir : null} /></span>
                  </th>
                  <th className="px-3 py-2 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort("subdomain")}>
                    <span className="inline-flex items-center gap-1">Subdomain <SortIcon dir={hook.sortBy === "subdomain" ? hook.sortDir : null} /></span>
                  </th>
                  {showAsset && <th className="px-3 py-2">Asset</th>}
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Matched At</th>
                  <th className="px-3 py-2">Status</th>
                  {!showAsset && <th className="px-3 py-2 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {hook.data.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-surface-hover transition-colors">
                    <td className="px-3 py-2"><SeverityBadge severity={c.severity} /></td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-foreground">{c.subdomain}</span>
                    </td>
                    {showAsset && (
                      <td className="px-3 py-2">
                        {c.target_id ? (
                          <Link to={`/target/${c.target_id}`} className="font-mono text-xs text-primary hover:underline">
                            {c.asset_domain ?? "—"}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">{c.asset_domain ?? "—"}</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="text-xs text-muted-foreground">{c.service || c.template_id || "—"}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-muted-foreground truncate max-w-xs block">{c.matched_at || c.url || "—"}</span>
                    </td>
                    <td className="px-3 py-2"><StatusBadge verified={c.verified} /></td>
                    {!showAsset && (
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {c.verified !== 1 && (
                            <button onClick={() => void setVerified(c.id, 1)} disabled={updating === c.id}
                              className="rounded border border-sev-critical/40 bg-sev-critical/10 px-2 py-0.5 text-[11px] text-sev-critical hover:bg-sev-critical/20 transition-colors disabled:opacity-50">
                              Confirm
                            </button>
                          )}
                          {c.verified !== -1 && (
                            <button onClick={() => void setVerified(c.id, -1)} disabled={updating === c.id}
                              className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                              False Positive
                            </button>
                          )}
                          {c.verified !== 0 && (
                            <button onClick={() => void setVerified(c.id, 0)} disabled={updating === c.id}
                              className="rounded border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
                              Reset
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">Page {hook.page} of {totalPages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => hook.setPage(hook.page - 1)} disabled={hook.page <= 1}
                  className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button onClick={() => hook.setPage(hook.page + 1)} disabled={hook.page >= totalPages}
                  className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
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
