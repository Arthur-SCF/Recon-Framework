import { useCallback, useEffect, useState } from "react";
import { Loader2, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { ExportMenu } from "@/components/ExportMenu";
import { InlineError } from "@/components/ui/InlineError";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { PaginatedResponse } from "@/types/api";
import { useWsSubscribe } from "@/hooks/useWebSocket";

type SortDir = "asc" | "desc" | null;
type PortTab = "all" | "verified";

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === "asc")  return <ArrowUp   className="h-3 w-3" />;
  if (dir === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" />;
}

interface PortEntry {
  host:            string;
  ip:              string | null;
  port:            number;
  protocol:        string;
  service:         string | null;
  service_version: string | null;
  standard:        boolean;
  subdomains:      string[];
}

interface Props {
  targetId: string;
}

const SERVICE_STYLE: Record<string, string> = {
  http:     "bg-blue-500/15 text-blue-400",
  https:    "bg-emerald-500/15 text-emerald-400",
  ssh:      "bg-violet-500/15 text-violet-400",
  smb:      "bg-red-500/15 text-red-400",
  ftp:      "bg-orange-500/15 text-orange-400",
  smtp:     "bg-yellow-500/15 text-yellow-400",
  pop3:     "bg-yellow-500/15 text-yellow-400",
  imap:     "bg-yellow-500/15 text-yellow-400",
  mysql:    "bg-sky-500/15 text-sky-400",
  postgres: "bg-sky-500/15 text-sky-400",
  mssql:    "bg-sky-500/15 text-sky-400",
  redis:    "bg-rose-500/15 text-rose-400",
  telnet:   "bg-red-500/15 text-red-400",
};

function ServiceBadge({ service }: { service: string }) {
  const cls = SERVICE_STYLE[service.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium font-mono uppercase ${cls}`}>
      {service}
    </span>
  );
}

const SUBDOMAIN_PREVIEW = 3;

export function PortsTable({ targetId }: Props) {
  const [tab, setTab] = useState<PortTab>("verified");

  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/ports`, window.location.origin);
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q)      url.searchParams.set("q",       params.q);
    if (params.sortBy) url.searchParams.set("sort_by", params.sortBy);
    url.searchParams.set("sort_dir", params.sortDir);
    if (tab === "verified") url.searchParams.set("has_service", "true");
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<PortEntry>>;
    });
  }, [targetId, tab]);

  const hook = useServerPagination<PortEntry>(fetchFn, { sortBy: "host", sortDir: "asc" });

  useWsSubscribe(["step_completed"], () => hook.refresh(), targetId);

  useEffect(() => {
    const interval = setInterval(() => hook.refresh(), 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSort(col: string) {
    if (hook.sortBy === col) {
      hook.setSort(col, hook.sortDir === "asc" ? "desc" : "asc");
    } else {
      hook.setSort(col, "asc");
    }
  }

  function switchTab(t: PortTab) {
    setTab(t);
    hook.setPage(1);
    hook.refresh();
  }

  const totalPages = Math.ceil(hook.total / hook.perPage);

  if (hook.loading && hook.data.length === 0) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Tab strip */}
      <div className="flex gap-1 border-b border-border">
        {(["verified", "all"] as PortTab[]).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-b-2 -mb-px capitalize ${
              tab === t
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "verified" ? "Verified" : "All"}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hook.q}
          onChange={(e) => hook.setQ(e.target.value)}
          placeholder="Filter by host, port, or service…"
          className="w-full sm:max-w-xs rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">
            {hook.total} result{hook.total !== 1 ? "s" : ""}
          </span>
          <ExportMenu targetId={targetId} type="ports" params={tab === "verified" ? { verified: "true" } : undefined} />
        </div>
      </div>

      {hook.error && !hook.loading && (
        <InlineError message={hook.error} onRetry={hook.refresh} />
      )}

      {hook.data.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">No open ports found</div>
      ) : (
        <>
          {/* Mobile card view */}
          <div className="sm:hidden flex flex-col gap-2">
            {hook.data.map((p) => {
              const rowKey = `${p.host}:${p.port}`;
              const preview = p.subdomains.slice(0, SUBDOMAIN_PREVIEW);
              const overflow = p.subdomains.length - SUBDOMAIN_PREVIEW;
              return (
                <div key={rowKey} className="rounded-lg border border-border bg-card p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-foreground">{p.host}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-mono text-xs font-bold text-foreground">{p.port}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">{p.protocol}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.service && <ServiceBadge service={p.service} />}
                    {preview.map((s) => (
                      <span key={s} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{s}</span>
                    ))}
                    {overflow > 0 && <span className="text-[10px] text-muted-foreground">+{overflow}</span>}
                  </div>
                  {p.ip && <p className="mt-1 text-[10px] text-muted-foreground font-mono">{p.ip}</p>}
                </div>
              );
            })}
          </div>

          {/* Desktop table view */}
          <div className="hidden sm:block rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="cursor-pointer px-3 py-2 font-medium text-muted-foreground hover:text-foreground select-none" onClick={() => handleSort("host")}>
                  <span className="inline-flex items-center gap-1">Host <SortIcon dir={hook.sortBy === "host" ? hook.sortDir : null} /></span>
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">IP</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Subdomains</th>
                <th className="cursor-pointer px-3 py-2 font-medium text-muted-foreground hover:text-foreground select-none" onClick={() => handleSort("port")}>
                  <span className="inline-flex items-center gap-1">Port <SortIcon dir={hook.sortBy === "port" ? hook.sortDir : null} /></span>
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Protocol</th>
                <th className="cursor-pointer px-3 py-2 font-medium text-muted-foreground hover:text-foreground select-none" onClick={() => handleSort("service")}>
                  <span className="inline-flex items-center gap-1">Service <SortIcon dir={hook.sortBy === "service" ? hook.sortDir : null} /></span>
                </th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Standard</th>
              </tr>
            </thead>
            <tbody>
              {hook.data.map((p) => {
                const rowKey  = `${p.host}:${p.port}`;
                const preview = p.subdomains.slice(0, SUBDOMAIN_PREVIEW);
                const overflow = p.subdomains.length - SUBDOMAIN_PREVIEW;
                return (
                  <tr key={rowKey} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 font-mono text-foreground">{p.host}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {p.ip ?? <span className="text-muted-foreground/30">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {p.subdomains.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {preview.map((s) => (
                            <span key={s} className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">{s}</span>
                          ))}
                          {overflow > 0 && <span className="text-[10px] text-muted-foreground">+{overflow}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground">{p.port}</td>
                    <td className="px-3 py-2 text-muted-foreground uppercase">{p.protocol}</td>
                    <td className="px-3 py-2">
                      {p.service ? (
                        <div className="flex flex-col gap-0.5">
                          <ServiceBadge service={p.service} />
                          {p.service_version && (
                            <span className="font-mono text-[10px] text-muted-foreground/60 truncate max-w-[160px]" title={p.service_version}>
                              {p.service_version}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/30 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.standard ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">standard</span>
                      ) : (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/15 text-amber-400">non-standard</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {(hook.page - 1) * hook.perPage + 1}–{Math.min(hook.page * hook.perPage, hook.total)} of {hook.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => hook.setPage(hook.page - 1)} disabled={hook.page <= 1}
              className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2">{hook.page} / {totalPages}</span>
            <button onClick={() => hook.setPage(hook.page + 1)} disabled={hook.page >= totalPages}
              className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
