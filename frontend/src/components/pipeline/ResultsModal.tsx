import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Loader2, X } from "lucide-react";

interface StepResultsData {
  type: "subdomains" | "live_hosts" | "screenshots" | "takeovers" | "list" | "cloud_assets" | "none";
  count: number;
  items: string[];
}

interface ResultsModalProps {
  targetId: string;
  sessionId: string;
  stepId: string;
  onClose: () => void;
}

export function ResultsModal({
  targetId,
  sessionId,
  stepId,
  onClose,
}: ResultsModalProps) {
  const [data, setData] = useState<StepResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    void fetch(
      `/api/v1/targets/${targetId}/sessions/${sessionId}/steps/${stepId}/results`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: StepResultsData) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [targetId, sessionId, stepId]);

  const filtered =
    data?.items.filter(
      (item) => !filter || item.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[3px]"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <motion.div
          className="relative w-full max-w-2xl max-h-[80vh] m-4 flex flex-col rounded-lg overflow-hidden bg-popover border border-border shadow-2xl shadow-black/60"
          onClick={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1,    y: 0  }}
          exit={{    opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: "spring", damping: 28, stiffness: 380 }}
        >
          {/* Accent bar */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent shrink-0" />

          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-gradient-to-r from-primary/[0.04] to-transparent shrink-0">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-medium text-foreground shrink-0">
                {stepId}
              </span>
              {data && (
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
                  {filter
                    ? `${filtered.length} / ${data.items.length} match`
                    : `${data.count} results`}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground/40 hover:text-foreground hover:bg-surface-hover transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Filter */}
          {data && data.items.length > 0 && (
            <div className="border-b border-border px-3 py-1.5 bg-muted/20 shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-transparent text-xs font-mono text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
              />
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-auto p-4">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : data === null ? (
              <p className="text-sm text-muted-foreground/50">Failed to load results.</p>
            ) : data.type === "live_hosts" ? (
              <p className="text-sm text-muted-foreground/70">
                {data.count} live host{data.count !== 1 ? "s" : ""} found — view
                them in the <strong className="text-foreground">Live Hosts</strong> tab.
              </p>
            ) : data.type === "screenshots" ? (
              <p className="text-sm text-muted-foreground/70">
                {data.count} screenshot{data.count !== 1 ? "s" : ""} taken — view
                them in the{" "}
                <strong className="text-foreground">Live Hosts</strong> tab (expand any row).
              </p>
            ) : data.type === "takeovers" && data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground/50">No takeover candidates found.</p>
            ) : data.type === "cloud_assets" ? (
              <div className="space-y-px">
                {filtered.map((item) => {
                  const m = item.match(/^\[(\w+)\] (.+)$/);
                  const badge = m?.[1] ?? "?";
                  const url   = m?.[2] ?? item;
                  const badgeClass = "bg-muted/60 text-muted-foreground";
                  return (
                    <div key={item} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover group transition-colors">
                      <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase ${badgeClass}`}>
                        {badge}
                      </span>
                      <span className="flex-1 font-mono text-xs text-foreground/80 truncate" title={url}>
                        {url}
                      </span>
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  );
                })}
                {filtered.length === 0 && filter && (
                  <p className="py-4 text-center text-xs text-muted-foreground/40">No matches.</p>
                )}
              </div>
            ) : data.type === "none" || data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground/50">
                {data.count > 0
                  ? `${data.count} results recorded — no detail view available for this step type.`
                  : "No results for this step."}
              </p>
            ) : (
              <div className="space-y-px">
                {filtered.map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover group transition-colors"
                  >
                    <span className="flex-1 font-mono text-xs text-foreground/80">
                      {item}
                    </span>
                    {data.type === "subdomains" && (
                      <a
                        href={`https://${item}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
                {filtered.length === 0 && filter && (
                  <p className="py-4 text-center text-xs text-muted-foreground/40">No matches.</p>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
