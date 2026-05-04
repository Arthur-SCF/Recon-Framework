import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ExportMenu } from "@/components/ExportMenu";
import { InlineError } from "@/components/ui/InlineError";
import {
  ExternalLink,
  RefreshCw,
  Globe,
  Lock,
  AlertTriangle,
  Camera,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTableSort, type SortDir } from "@/lib/useTableSort";
import type { LiveHost } from "@/types/api";

type LiveHostCol = "url" | "code" | "title" | "webserver" | "rt";

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === "asc")  return <ArrowUp   className="h-3 w-3" />;
  if (dir === "desc") return <ArrowDown className="h-3 w-3" />;
  return <ArrowUpDown className="h-3 w-3 opacity-30" />;
}

const PAGE_SIZE = 100;

interface Props {
  targetId: string;
  /** When provided, the table renders these hosts directly (no internal fetch/filter/toolbar). */
  hosts?: LiveHost[];
  /** When provided, clicking a row opens the host detail panel instead of expanding inline. */
  onHostClick?: (host: LiveHost) => void;
}

// Status code → colour
function statusColor(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code >= 200 && code < 300) return "text-green-400";
  if (code >= 300 && code < 400) return "text-blue-400";
  if (code >= 400 && code < 500) return "text-yellow-400";
  if (code >= 500) return "text-red-400";
  return "text-muted-foreground";
}

function SecurityBadge({
  label,
  ok,
  title,
}: {
  label: string;
  ok: boolean | null;
  title?: string;
}) {
  if (ok === null) return null;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded px-1 py-0.5 text-[10px] font-mono font-medium",
        ok
          ? "bg-green-950 text-green-300"
          : "bg-yellow-950 text-yellow-300",
      )}
    >
      {label}
    </span>
  );
}

function TechBadge({ tech }: { tech: string }) {
  return (
    <span className="inline-flex items-center rounded bg-primary/10 px-1 py-0.5 text-[10px] font-mono text-primary">
      {tech}
    </span>
  );
}

export function LiveHostsTable({ targetId, hosts: controlledHosts, onHostClick }: Props) {
  const [ownHosts, setOwnHosts] = useState<LiveHost[]>([]);
  const [loading, setLoading] = useState(!controlledHosts);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [schemeFilter, setSchemeFilter] = useState<"all" | "https" | "http">(
    "all",
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const { sort, toggle } = useTableSort<LiveHostCol>();

  // Controlled mode: hosts come from parent (LiveHostsView handles fetch + filter)
  const isControlled = controlledHosts !== undefined;
  const hosts = isControlled ? controlledHosts : ownHosts;

  const load = useCallback(() => {
    if (isControlled) return;
    setLoading(true);
    void fetch(`/api/v1/targets/${targetId}/live-hosts`)
      .then((r) => (r.ok ? (r.json() as Promise<LiveHost[]>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setOwnHosts(data);
        setFetchError(null);
        setLoading(false);
      })
      .catch(() => {
        setFetchError("Failed to load data");
        setLoading(false);
      });
  }, [targetId, isControlled]);

  useEffect(() => {
    if (isControlled) return;
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load, isControlled]);

  const filtered = useMemo(() => {
    if (isControlled) return hosts; // Already filtered by parent
    return hosts.filter((h) => {
      const text = filter.toLowerCase();
      const matchText =
        !text ||
        h.url.toLowerCase().includes(text) ||
        (h.title ?? "").toLowerCase().includes(text) ||
        (h.webserver ?? "").toLowerCase().includes(text) ||
        (h.tech ?? []).some((t) => t.toLowerCase().includes(text));
      const matchScheme =
        schemeFilter === "all" || h.scheme === schemeFilter;
      return matchText && matchScheme;
    });
  }, [hosts, filter, schemeFilter, isControlled]);

  // Reset to page 0 when filter or sort changes
  useEffect(() => { setPage(0); }, [filter, schemeFilter, sort]);

  const sorted = useMemo(() => {
    if (!sort.col || !sort.dir) return filtered;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sort.col === "url")       cmp = a.url.localeCompare(b.url);
      else if (sort.col === "code") cmp = (a.status_code ?? -1) - (b.status_code ?? -1);
      else if (sort.col === "title") cmp = (a.title ?? "").localeCompare(b.title ?? "");
      else if (sort.col === "webserver") cmp = (a.webserver ?? "").localeCompare(b.webserver ?? "");
      else if (sort.col === "rt")   cmp = (a.response_time ?? -1) - (b.response_time ?? -1);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sort]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const schemes = ["all", "https", "http"] as const;

  if (!isControlled && loading && hosts.length === 0) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Loading live hosts...
      </div>
    );
  }

  if (!isControlled && !loading && hosts.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No live hosts yet. Run a scan to discover them.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Error — only in standalone mode */}
      {!isControlled && fetchError && (
        <InlineError message={fetchError} onRetry={load} />
      )}

      {/* Toolbar — only in standalone mode */}
      {!isControlled && (
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Filter by URL, title, webserver, tech..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 min-w-0 rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex rounded border border-border overflow-hidden text-xs">
          {schemes.map((s) => (
            <button
              key={s}
              onClick={() => setSchemeFilter(s)}
              className={cn(
                "px-2.5 py-1.5 capitalize transition-colors",
                schemeFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <ExportMenu targetId={targetId} type="hosts" />
        <span className="text-xs text-muted-foreground">
          {sorted.length} / {hosts.length}
        </span>
      </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggle("url")}>
                <span className="inline-flex items-center gap-1">URL <SortIcon dir={sort.col === "url" ? sort.dir : null} /></span>
              </th>
              <th className="px-3 py-2 font-medium w-14 text-center cursor-pointer select-none hover:text-foreground" onClick={() => toggle("code")}>
                <span className="inline-flex items-center justify-center gap-1">Code <SortIcon dir={sort.col === "code" ? sort.dir : null} /></span>
              </th>
              <th className="px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggle("title")}>
                <span className="inline-flex items-center gap-1">Title <SortIcon dir={sort.col === "title" ? sort.dir : null} /></span>
              </th>
              <th className="px-3 py-2 font-medium cursor-pointer select-none hover:text-foreground" onClick={() => toggle("webserver")}>
                <span className="inline-flex items-center gap-1">Webserver <SortIcon dir={sort.col === "webserver" ? sort.dir : null} /></span>
              </th>
              <th className="px-3 py-2 font-medium">Tech</th>
              <th className="px-3 py-2 font-medium">Security</th>
              <th className="px-3 py-2 font-medium w-16 text-right cursor-pointer select-none hover:text-foreground" onClick={() => toggle("rt")}>
                <span className="inline-flex items-center justify-end gap-1">RT <SortIcon dir={sort.col === "rt" ? sort.dir : null} /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((host) => {
              const isExpanded = expanded === host.id;
              return (
                <Fragment key={host.id}>
                  <tr
                    onClick={() =>
                      onHostClick ? onHostClick(host) : setExpanded(isExpanded ? null : host.id)
                    }
                    className="cursor-pointer border-b border-border/50 hover:bg-muted/20 transition-colors"
                  >
                    {/* URL */}
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {host.scheme === "https" ? (
                          <Lock className="h-3 w-3 text-green-400 shrink-0" />
                        ) : (
                          <Globe className="h-3 w-3 text-yellow-400 shrink-0" />
                        )}
                        <span className="font-mono text-xs text-foreground truncate max-w-xs">
                          {host.url}
                        </span>
                        <a
                          href={host.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                        {host.cdn && (
                          <span className="shrink-0 rounded bg-blue-950 px-1 py-0.5 text-[10px] font-mono text-blue-300">
                            CDN{host.cdn_name ? `: ${host.cdn_name}` : ""}
                          </span>
                        )}
                        {host.screenshot_path && (
                          <span title="Screenshot available">
                            <Camera className="h-3 w-3 shrink-0 text-muted-foreground" />
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status code */}
                    <td className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold",
                          statusColor(host.status_code),
                        )}
                      >
                        {host.status_code ?? "—"}
                      </span>
                    </td>

                    {/* Title */}
                    <td className="px-3 py-2 max-w-[200px]">
                      <span className="truncate block text-xs text-muted-foreground">
                        {host.title || "—"}
                      </span>
                    </td>

                    {/* Webserver */}
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {host.webserver || "—"}
                      </span>
                    </td>

                    {/* Tech */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(host.tech ?? []).slice(0, 3).map((t) => (
                          <TechBadge key={t} tech={t} />
                        ))}
                        {(host.tech ?? []).length > 3 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{(host.tech ?? []).length - 3}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Security headers */}
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <SecurityBadge label="CSP"  ok={host.has_csp}  title="Content-Security-Policy" />
                        <SecurityBadge label="HSTS" ok={host.has_hsts} title="Strict-Transport-Security" />
                        <SecurityBadge label="XFO"  ok={host.has_xfo}  title="X-Frame-Options" />
                        {host.tls_expired && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-red-950 px-1 py-0.5 text-[10px] font-mono text-red-300">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            TLS exp
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Response time */}
                    <td className="px-3 py-2 text-right">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {host.response_time
                          ? `${(host.response_time * 1000).toFixed(0)}ms`
                          : "—"}
                      </span>
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <tr key={`${host.id}-detail`} className="bg-muted/10 border-b border-border/50">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-1 gap-x-8 gap-y-1 text-xs sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                          <Detail label="Host"       value={host.host} />
                          <Detail label="Port"       value={host.port} />
                          <Detail label="Final URL"  value={host.final_url} mono />
                          <Detail label="CNAME"      value={host.cname} mono />
                          {(host.a_records ?? []).length > 0 && (
                            <Detail label="A Records" value={(host.a_records ?? []).join(", ")} mono />
                          )}
                          {host.content_type && (
                            <Detail label="Content-Type" value={host.content_type} />
                          )}
                          {host.content_length !== null && (
                            <Detail label="Content-Length" value={`${host.content_length} B`} />
                          )}
                          {host.tls_version && (
                            <Detail label="TLS"   value={`${host.tls_version} / ${host.tls_cipher}`} mono />
                          )}
                          {host.tls_subject_cn && (
                            <Detail label="TLS CN" value={host.tls_subject_cn} mono />
                          )}
                          {host.tls_issuer && (
                            <Detail label="Issuer" value={host.tls_issuer} />
                          )}
                          <Detail label="First seen" value={host.first_seen} />
                          <Detail label="Last seen"  value={host.last_seen}  />
                          {host.response_hash && (
                            <Detail label="Body hash" value={host.response_hash.slice(0, 12) + "…"} mono />
                          )}
                          {(host.tech ?? []).length > 0 && (
                            <div className="col-span-2 flex flex-wrap gap-1 mt-0.5">
                              <span className="text-muted-foreground w-24 shrink-0">Tech</span>
                              {(host.tech ?? []).map((t) => (
                                <TechBadge key={t} tech={t} />
                              ))}
                            </div>
                          )}
                        </div>
                        {host.screenshot_path && (
                          <div className="mt-3">
                            <a
                              href={`/api/v1/targets/${targetId}/hosts/${host.id}/screenshot`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <img
                                src={`/api/v1/targets/${targetId}/hosts/${host.id}/screenshot`}
                                alt={`Screenshot of ${host.url}`}
                                className="max-w-xs rounded border border-border hover:opacity-90 transition-opacity"
                              />
                            </a>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Page {page + 1} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded border border-border bg-background px-2 py-1 disabled:opacity-40 hover:text-foreground transition-colors"
            >
              Prev
            </button>
            <input
              type="number"
              min={1}
              max={totalPages}
              placeholder={String(page + 1)}
              className="w-12 rounded border border-border bg-background px-1.5 py-1 text-center text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const v = parseInt((e.target as HTMLInputElement).value, 10);
                if (!isNaN(v)) setPage(Math.min(totalPages - 1, Math.max(0, v - 1)));
                (e.target as HTMLInputElement).value = "";
              }}
            />
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded border border-border bg-background px-2 py-1 disabled:opacity-40 hover:text-foreground transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex gap-1 text-xs">
      <span className="text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={cn("text-foreground break-all", mono && "font-mono")}>
        {String(value)}
      </span>
    </div>
  );
}
