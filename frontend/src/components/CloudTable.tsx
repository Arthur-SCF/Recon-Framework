import { useCallback, useEffect } from "react";
import { Cloud, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { InlineError } from "@/components/ui/InlineError";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";
import type { PaginatedResponse, CloudAsset, S3Bucket, CloudResultsResponse } from "@/types/api";
import { ExportMenu } from "./ExportMenu";
import { CloudProviderChart } from "@/components/charts/CloudProviderChart";
import { CloudBucketStatusChart } from "@/components/charts/CloudBucketStatusChart";
import { useWsSubscribe } from "@/hooks/useWebSocket";

interface Props {
  targetId: string;
}

const PROVIDER_STYLE: Record<string, string> = {
  s3:      "bg-orange-500/15 text-orange-400",
  azure:   "bg-blue-500/15 text-blue-400",
  gcp:     "bg-sky-500/15 text-sky-400",
  generic: "bg-muted text-muted-foreground",
};

function ProviderBadge({ type }: { type: string }) {
  const cls = PROVIDER_STYLE[type.toLowerCase()] ?? PROVIDER_STYLE.generic;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium font-mono uppercase ${cls}`}>
      {type}
    </span>
  );
}

function ExistsBadge({ exists }: { exists: boolean }) {
  return exists ? (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-400">exists</span>
  ) : (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">not found</span>
  );
}

function AccessBadge({ active, label }: { active: boolean; label: string }) {
  return active ? (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-red-500/15 text-red-400">{label}</span>
  ) : (
    <span className="text-muted-foreground/30 text-[10px]">—</span>
  );
}

function Paginator({ page, total, perPage, onPage }: { page: number; total: number; perPage: number; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground pt-1">
      <span>Page {page} of {totalPages} ({total.toLocaleString()} total)</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="rounded p-1 hover:bg-muted/50 disabled:opacity-30 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function CloudTable({ targetId }: Props) {
  const assetsFetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/cloud`, window.location.origin);
    url.searchParams.set("type",     "cloud");
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q) url.searchParams.set("q", params.q);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (r.json() as Promise<CloudResultsResponse>).then((d) => d.cloud_assets as PaginatedResponse<CloudAsset>);
    });
  }, [targetId]);

  const bucketsFetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/cloud`, window.location.origin);
    url.searchParams.set("type",     "s3");
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q) url.searchParams.set("q", params.q);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (r.json() as Promise<CloudResultsResponse>).then((d) => d.s3_buckets as PaginatedResponse<S3Bucket>);
    });
  }, [targetId]);

  const assets  = useServerPagination<CloudAsset>(assetsFetchFn);
  const buckets = useServerPagination<S3Bucket>(bucketsFetchFn);

  useWsSubscribe(["step_completed"], () => { assets.refresh(); buckets.refresh(); }, targetId);

  useEffect(() => {
    const interval = setInterval(() => { assets.refresh(); buckets.refresh(); }, 30_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!assets.loading && !buckets.loading && assets.total === 0 && buckets.total === 0 && !assets.q && !buckets.q) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
        <Cloud className="h-8 w-8 opacity-30" />
        <span className="text-sm">No cloud results yet</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Charts */}
      {(assets.total > 0 || buckets.total > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <CloudProviderChart assets={assets.data.map((a) => ({ provider: a.asset_type }))} />
          <CloudBucketStatusChart buckets={buckets.data} />
        </div>
      )}

      {/* ── Cloud Assets ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Cloud Assets
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono normal-case">
              {assets.total}
            </span>
          </h3>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="text"
              value={assets.q}
              onChange={(e) => assets.setQ(e.target.value)}
              placeholder="Filter…"
              className="h-7 w-28 sm:w-44 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <ExportMenu targetId={targetId} type="cloud" />
          </div>
        </div>

        {assets.error && !assets.loading && (
          <InlineError message={assets.error} onRetry={assets.refresh} />
        )}

        {assets.data.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {assets.loading ? "Loading…" : assets.q ? "No matches." : "No cloud assets discovered."}
          </p>
        ) : (
          <>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Provider</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">URL</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Keyword</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.data.map((a) => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2"><ProviderBadge type={a.asset_type} /></td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5 group">
                          <span className="font-mono text-foreground truncate max-w-md" title={a.url}>{a.url}</span>
                          <a href={a.url} target="_blank" rel="noreferrer"
                            className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{a.keyword ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginator page={assets.page} total={assets.total} perPage={assets.perPage} onPage={assets.setPage} />
          </>
        )}
      </section>

      {/* ── S3 Buckets ───────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            S3 Buckets
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono normal-case">
              {buckets.total}
            </span>
          </h3>
          <input
            type="text"
            value={buckets.q}
            onChange={(e) => buckets.setQ(e.target.value)}
            placeholder="Filter…"
            className="ml-auto h-7 w-28 sm:w-44 rounded-md border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {buckets.error && !buckets.loading && (
          <InlineError message={buckets.error} onRetry={buckets.refresh} />
        )}

        {buckets.data.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {buckets.loading ? "Loading…" : buckets.q ? "No matches." : "No S3 buckets scanned."}
          </p>
        ) : (
          <>
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left">
                    <th className="px-3 py-2 font-medium text-muted-foreground">Bucket</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Public Read</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">Public Write</th>
                    <th className="px-3 py-2 font-medium text-muted-foreground">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.data.map((b) => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 font-mono text-foreground">
                        {b.bucket_name}
                        {b.region && <span className="ml-1.5 text-muted-foreground/50">{b.region}</span>}
                      </td>
                      <td className="px-3 py-2"><ExistsBadge exists={b.bucket_exists} /></td>
                      <td className="px-3 py-2"><AccessBadge active={b.public_read} label="public" /></td>
                      <td className="px-3 py-2"><AccessBadge active={b.public_write} label="public" /></td>
                      <td className="px-3 py-2">
                        {b.url ? (
                          <a href={b.url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 font-mono text-primary hover:underline">
                            <span className="truncate max-w-xs">{b.url}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginator page={buckets.page} total={buckets.total} perPage={buckets.perPage} onPage={buckets.setPage} />
          </>
        )}
      </section>
    </div>
  );
}
