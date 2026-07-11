import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Camera, ChevronLeft, ChevronRight, ImageOff, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveHost, PaginatedResponse } from "@/types/api";
import { ExportMenu } from "./ExportMenu";
import { InlineError } from "@/components/ui/InlineError";
import { useServerPagination, type PaginationParams } from "@/lib/useServerPagination";

interface Props {
  targetId: string;
}

type StatusRange = "all" | "2xx" | "3xx" | "4xx" | "5xx";
type Scheme = "all" | "https" | "http";

const STATUS_RANGES: Record<StatusRange, { gte: number; lte: number } | null> = {
  "all": null,
  "2xx": { gte: 200, lte: 299 },
  "3xx": { gte: 300, lte: 399 },
  "4xx": { gte: 400, lte: 499 },
  "5xx": { gte: 500, lte: 599 },
};

function statusColor(code: number | null): string {
  if (!code) return "bg-muted text-muted-foreground";
  if (code < 300) return "bg-sev-low/15 text-sev-low";
  if (code < 400) return "bg-sev-info/15 text-sev-info";
  if (code < 500) return "bg-sev-medium/15 text-sev-medium";
  return "bg-sev-critical/15 text-sev-critical";
}

function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-muted/50">
        <ImageOff className="h-6 w-6 text-muted-foreground/30" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="w-full h-full object-cover object-top transition-transform group-hover:scale-[1.02]"
      onError={() => setFailed(true)}
    />
  );
}

function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex items-center justify-center w-full h-48 text-muted-foreground/40">
        <span className="text-sm">Screenshot unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-contain max-h-[60vh]"
      onError={() => setFailed(true)}
    />
  );
}

export function ScreenshotGallery({ targetId }: Props) {
  const [status,   setStatus]   = useState<StatusRange>("all");
  const [scheme,   setScheme]   = useState<Scheme>("all");
  const [selected, setSelected] = useState<number | null>(null);

  const statusRef = useRef<StatusRange>("all");
  const schemeRef = useRef<Scheme>("all");

  const fetchFn = useCallback((params: PaginationParams) => {
    const url = new URL(`/api/v1/targets/${targetId}/live-hosts`, window.location.origin);
    url.searchParams.set("has_screenshot", "true");
    url.searchParams.set("page",     String(params.page));
    url.searchParams.set("per_page", String(params.perPage));
    if (params.q) url.searchParams.set("q", params.q);
    const range = STATUS_RANGES[statusRef.current];
    if (range) {
      url.searchParams.set("status_code_gte", String(range.gte));
      url.searchParams.set("status_code_lte", String(range.lte));
    }
    if (schemeRef.current !== "all") url.searchParams.set("scheme", schemeRef.current);
    return fetch(url.toString()).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<PaginatedResponse<LiveHost>>;
    });
  }, [targetId]);

  const hook = useServerPagination<LiveHost>(fetchFn, { perPage: 24 });

  useEffect(() => {
    statusRef.current = status;
    setSelected(null);
    hook.setPage(1);
    hook.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    schemeRef.current = scheme;
    setSelected(null);
    hook.setPage(1);
    hook.refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme]);

  const totalPages = Math.ceil(hook.total / hook.perPage);

  if (hook.loading && hook.data.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hook.loading && hook.total === 0 && !hook.q && status === "all" && scheme === "all") {
    return (
      <div className="deck-grid flex flex-col items-center gap-3 rounded-lg border border-border py-16 text-muted-foreground">
        <Camera className="h-10 w-10 opacity-30" />
        <p className="text-sm">No screenshots yet. Run a scan with GoWitness enabled.</p>
      </div>
    );
  }

  const current = selected !== null ? hook.data[selected] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={hook.q}
          onChange={(e) => hook.setQ(e.target.value)}
          placeholder="Search URL, title, tech…"
          className="h-8 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary flex-1 min-w-0"
        />

        <div className="flex rounded border border-border overflow-hidden text-xs">
          {(["all", "2xx", "3xx", "4xx", "5xx"] as StatusRange[]).map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn(
                "px-2.5 py-1.5 transition-colors",
                status === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
              )}>
              {s}
            </button>
          ))}
        </div>

        <div className="flex rounded border border-border overflow-hidden text-xs">
          {(["all", "https", "http"] as Scheme[]).map((s) => (
            <button key={s} onClick={() => setScheme(s)}
              className={cn(
                "px-2.5 py-1.5 capitalize transition-colors",
                scheme === s ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
              )}>
              {s}
            </button>
          ))}
        </div>

        <ExportMenu targetId={targetId} type="screenshots" />
        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
          {hook.total.toLocaleString()} screenshots
        </span>
      </div>

      {hook.error && !hook.loading && (
        <InlineError message={hook.error} onRetry={hook.refresh} />
      )}

      {hook.data.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No results match the current filter.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {hook.data.map((host, idx) => (
            <button
              key={host.id}
              onClick={() => setSelected(idx)}
              className="group relative flex flex-col rounded-lg border border-border bg-card overflow-hidden hover:border-primary/50 transition-colors text-left"
            >
              <div className="aspect-video w-full bg-muted overflow-hidden">
                <Thumbnail
                  src={`/api/v1/targets/${targetId}/hosts/${host.id}/screenshot`}
                  alt={host.url}
                />
              </div>
              <div className="p-2 flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  {host.status_code && (
                    <span className={cn("rounded px-1 py-0.5 text-[10px] font-mono font-medium shrink-0", statusColor(host.status_code))}>
                      {host.status_code}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground truncate" title={host.url}>
                    {host.url.replace(/^https?:\/\//, "")}
                  </span>
                </div>
                {host.title && (
                  <span className="text-[10px] text-foreground/70 truncate">{host.title}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono tabular-nums">
            Showing {(hook.page - 1) * hook.perPage + 1}–{Math.min(hook.page * hook.perPage, hook.total)} of {hook.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => hook.setPage(hook.page - 1)}
              disabled={hook.page <= 1}
              className="rounded p-1 hover:bg-surface-hover disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-mono tabular-nums">{hook.page} / {totalPages}</span>
            <button
              onClick={() => hook.setPage(hook.page + 1)}
              disabled={hook.page >= totalPages}
              className="rounded p-1 hover:bg-surface-hover disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <Dialog.Root open={selected !== null} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <Dialog.Content className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "w-[calc(100%-2rem)] max-w-4xl rounded-lg border border-border bg-card p-0 shadow-2xl overflow-hidden",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
            "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "max-h-[90vh] flex flex-col",
          )}>
            <Dialog.Title className="sr-only">
              Screenshot — {current?.url ?? ""}
            </Dialog.Title>

            {current && (
              <>
                <div className="relative flex-1 bg-black min-h-0">
                  <LightboxImage
                    src={`/api/v1/targets/${targetId}/hosts/${current.id}/screenshot`}
                    alt={current.url}
                  />

                  <button
                    onClick={() => setSelected((i) => i !== null ? Math.max(0, i - 1) : null)}
                    disabled={selected === 0}
                    className="absolute left-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 transition"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={() => setSelected((i) => i !== null ? Math.min(hook.data.length - 1, i + 1) : null)}
                    disabled={selected === hook.data.length - 1}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 disabled:opacity-30 transition"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>

                  <Dialog.Close className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition">
                    <X className="h-4 w-4" />
                  </Dialog.Close>
                </div>

                <div className="p-4 border-t border-border space-y-2 overflow-y-auto max-h-48">
                  <div className="flex items-center gap-2 flex-wrap">
                    {current.status_code && (
                      <span className={cn("rounded px-1.5 py-0.5 text-xs font-mono font-semibold", statusColor(current.status_code))}>
                        {current.status_code}
                      </span>
                    )}
                    <a href={current.url} target="_blank" rel="noreferrer"
                      className="font-mono text-xs text-primary hover:underline truncate">
                      {current.url}
                    </a>
                  </div>
                  {current.title && <p className="text-xs text-foreground">{current.title}</p>}
                  {(current.tech ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {(current.tech ?? []).map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </div>
                  )}
                  <p className="font-mono text-[10px] tabular-nums text-faint-foreground">
                    {selected !== null ? `${selected + 1} / ${hook.data.length}` : ""}
                    {current.webserver ? ` · ${current.webserver}` : ""}
                  </p>
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
