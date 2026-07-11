import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { TimelineChart } from "./TimelineChart";
import { cn } from "@/lib/utils";
import type { DiffCompareResult, ScanSession } from "@/types/api";

interface DiffCompareViewProps {
  targetId: string;
}

const EVENT_TYPES = ["discovered", "changed", "gone", "returned"] as const;

const EVENT_COLORS: Record<string, string> = {
  discovered: "text-sev-low",
  changed:    "text-sev-medium",
  gone:       "text-sev-critical",
  returned:   "text-sev-info",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function statusBadge(code: number | null) {
  if (!code) return null;
  const color =
    code >= 200 && code < 300 ? "bg-sev-low/15 text-sev-low" :
    code >= 300 && code < 400 ? "bg-sev-info/15 text-sev-info" :
    code >= 400 && code < 500 ? "bg-sev-medium/15 text-sev-medium" :
    "bg-sev-critical/15 text-sev-critical";
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-mono font-medium tabular-nums", color)}>
      {code}
    </span>
  );
}

function CollapsibleList({
  title, color, items, renderItem,
}: {
  title: string;
  color: string;
  items: unknown[];
  renderItem: (item: unknown, i: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState(items.length <= 5);
  if (items.length === 0) return null;
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium bg-muted/20 hover:bg-muted/40 transition-colors"
      >
        <span className={color}>{title} <span className="font-mono font-normal tabular-nums text-muted-foreground">({items.length})</span></span>
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
      {open && (
        <div className="divide-y divide-border/50 max-h-60 overflow-y-auto">
          {items.map((item, i) => renderItem(item, i))}
        </div>
      )}
    </div>
  );
}

function exportMarkdown(
  compareData: DiffCompareResult,
  domain: string,
  sessionALabel: string,
  sessionBLabel: string,
): void {
  const { session_a: a, session_b: b, diff } = compareData;
  const lines: string[] = [
    `# Scan Comparison: ${domain}`,
    "",
    `**Scan A:** ${sessionALabel} — ${a.subdomain_total} subdomains, ${a.counts.discovered ?? 0} hosts discovered`,
    `**Scan B:** ${sessionBLabel} — ${b.subdomain_total} subdomains, ${b.counts.discovered ?? 0} hosts discovered`,
    "",
  ];

  if (diff.hosts_discovered_in_b.length > 0) {
    lines.push("## New Hosts (in Scan B)", "");
    for (const h of diff.hosts_discovered_in_b) {
      lines.push(`- ${h.url}${h.status_code ? ` (${h.status_code})` : ""}${h.title ? ` — ${h.title}` : ""}`);
    }
    lines.push("");
  }

  if (diff.hosts_gone_in_b.length > 0) {
    lines.push("## Gone Offline (in Scan B)", "");
    for (const h of diff.hosts_gone_in_b) {
      lines.push(`- ${h.url}`);
    }
    lines.push("");
  }

  if (diff.hosts_changed_in_b.length > 0) {
    lines.push("## Changed Hosts (in Scan B)", "");
    for (const h of diff.hosts_changed_in_b) {
      const changedFields = Object.entries(h.changes)
        .map(([field, { old: o, new: n }]) => `${field}: ${String(o)} → ${String(n)}`)
        .join(", ");
      lines.push(`- ${h.url}: ${changedFields}`);
    }
    lines.push("");
  }

  const content = lines.join("\n");
  const blob = new Blob([content], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `scan-comparison-${domain}-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DiffCompareView({ targetId }: DiffCompareViewProps) {
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionA, setSessionA] = useState("");
  const [sessionB, setSessionB] = useState("");
  const [compareData, setCompareData] = useState<DiffCompareResult | null>(null);
  const [comparing, setComparing] = useState(false);
  const [domain, setDomain] = useState("");

  const loadSessions = useCallback(() => {
    void fetch(`/api/v1/targets/${targetId}/sessions`)
      .then((r) => (r.ok ? (r.json() as Promise<ScanSession[]>) : []))
      .then((data) => {
        setSessions(data);
        setSessionsLoading(false);
      })
      .catch(() => setSessionsLoading(false));
  }, [targetId]);

  useEffect(() => {
    loadSessions();
    // Fetch domain for export filename
    void fetch(`/api/v1/targets/${targetId}`)
      .then((r) => r.ok ? r.json() as Promise<{ domain: string }> : null)
      .then((t) => { if (t) setDomain(t.domain); })
      .catch(() => {});
  }, [loadSessions, targetId]);

  useEffect(() => {
    if (!sessionA || !sessionB || sessionA === sessionB) {
      setCompareData(null);
      return;
    }
    setComparing(true);
    void fetch(
      `/api/v1/targets/${targetId}/diff/compare?session_a=${sessionA}&session_b=${sessionB}`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<DiffCompareResult>) : null))
      .then((data) => {
        setCompareData(data);
        setComparing(false);
      })
      .catch(() => setComparing(false));
  }, [sessionA, sessionB, targetId]);

  const completedSessions = sessions.filter((s) =>
    ["completed", "cancelled", "error"].includes(s.status),
  );

  function sessionLabel(s: ScanSession): string {
    return `Scan ${formatDate(s.started_at)} (${s.status})`;
  }

  const sessionAObj = completedSessions.find((s) => s.id === sessionA);
  const sessionBObj = completedSessions.find((s) => s.id === sessionB);

  return (
    <div className="flex flex-col gap-6">
      {/* Timeline overview */}
      <TimelineChart targetId={targetId} />

      {/* Session comparison */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Compare Scans</h3>
          {compareData && (
            <button
              onClick={() => exportMarkdown(
                compareData,
                domain,
                sessionAObj ? sessionLabel(sessionAObj) : sessionA,
                sessionBObj ? sessionLabel(sessionBObj) : sessionB,
              )}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export .md
            </button>
          )}
        </div>

        {sessionsLoading ? (
          <p className="text-xs text-muted-foreground">Loading sessions…</p>
        ) : completedSessions.length < 2 ? (
          <p className="text-xs text-muted-foreground">
            At least 2 completed scans are needed to compare.
          </p>
        ) : (
          <>
            {/* Session selectors */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
              <select
                value={sessionA}
                onChange={(e) => setSessionA(e.target.value)}
                className="flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select scan A…</option>
                {completedSessions.map((s) => (
                  <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
                ))}
              </select>

              <span className="text-xs text-muted-foreground shrink-0 text-center sm:text-left">vs</span>

              <select
                value={sessionB}
                onChange={(e) => setSessionB(e.target.value)}
                className="flex-1 rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="">Select scan B…</option>
                {completedSessions.map((s) => (
                  <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
                ))}
              </select>
            </div>

            {/* Comparison results */}
            {sessionA && sessionB && sessionA !== sessionB && (
              <div className="flex flex-col gap-3">
                {comparing ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">Comparing…</p>
                ) : compareData ? (
                  <>
                    {/* Summary delta */}
                    {(compareData.session_a.subdomain_total > 0 || compareData.session_b.subdomain_total > 0) && (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-muted/20 border border-border px-3 py-2 text-xs text-muted-foreground">
                        <span>
                          Scan A: <strong className="font-mono font-semibold tabular-nums text-foreground">{compareData.session_a.subdomain_total.toLocaleString()}</strong> subdomains
                        </span>
                        <span>→</span>
                        <span>
                          Scan B: <strong className="font-mono font-semibold tabular-nums text-foreground">{compareData.session_b.subdomain_total.toLocaleString()}</strong> subdomains
                          {compareData.session_b.subdomain_total - compareData.session_a.subdomain_total !== 0 && (
                            <span className={cn(
                              "ml-1 font-mono font-medium tabular-nums",
                              compareData.session_b.subdomain_total > compareData.session_a.subdomain_total
                                ? "text-sev-low" : "text-sev-critical",
                            )}>
                              ({compareData.session_b.subdomain_total > compareData.session_a.subdomain_total ? "+" : ""}
                              {(compareData.session_b.subdomain_total - compareData.session_a.subdomain_total).toLocaleString()})
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    {/* Event counts table */}
                    <div className="overflow-x-auto rounded-md border border-border">
                      <table className="w-full min-w-[420px] text-xs">
                        <thead>
                          <tr className="border-b border-border bg-muted/30 text-left">
                            <th className="px-3 py-2 text-muted-foreground font-medium">Event</th>
                            <th className="px-3 py-2 text-muted-foreground font-medium">
                              Scan A ({sessionAObj ? formatDate(sessionAObj.started_at) : ""})
                            </th>
                            <th className="px-3 py-2 text-muted-foreground font-medium">
                              Scan B ({sessionBObj ? formatDate(sessionBObj.started_at) : ""})
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {EVENT_TYPES.map((evt) => {
                            const cA = compareData.session_a.counts[evt] ?? 0;
                            const cB = compareData.session_b.counts[evt] ?? 0;
                            return (
                              <tr key={evt} className="border-b border-border/50 last:border-0 hover:bg-muted/10">
                                <td className="px-3 py-2">
                                  <span className={`font-mono capitalize ${EVENT_COLORS[evt]}`}>{evt}</span>
                                </td>
                                <td className="px-3 py-2 font-mono font-semibold tabular-nums text-foreground">{cA}</td>
                                <td className="px-3 py-2 font-mono font-semibold tabular-nums text-foreground">{cB}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Rich diff lists */}
                    <CollapsibleList
                      title="New hosts discovered in Scan B"
                      color="text-sev-low"
                      items={compareData.diff.hosts_discovered_in_b}
                      renderItem={(item) => {
                        const h = item as { url: string; status_code: number | null; title: string | null };
                        return (
                          <div key={h.url} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/10">
                            {statusBadge(h.status_code)}
                            <span className="font-mono text-foreground truncate flex-1">{h.url}</span>
                            {h.title && <span className="text-muted-foreground truncate max-w-48">{h.title}</span>}
                          </div>
                        );
                      }}
                    />

                    <CollapsibleList
                      title="Hosts went offline in Scan B"
                      color="text-sev-critical"
                      items={compareData.diff.hosts_gone_in_b}
                      renderItem={(item) => {
                        const h = item as { url: string };
                        return (
                          <div key={h.url} className="px-3 py-1.5 text-xs hover:bg-muted/10">
                            <span className="font-mono text-muted-foreground">{h.url}</span>
                          </div>
                        );
                      }}
                    />

                    <CollapsibleList
                      title="Hosts changed in Scan B"
                      color="text-sev-medium"
                      items={compareData.diff.hosts_changed_in_b}
                      renderItem={(item) => {
                        const h = item as { url: string; changes: Record<string, { old: unknown; new: unknown }> };
                        const fields = Object.entries(h.changes)
                          .map(([f, { old: o, new: n }]) => `${f}: ${String(o)} → ${String(n)}`)
                          .join(" · ");
                        return (
                          <div key={h.url} className="px-3 py-1.5 text-xs hover:bg-muted/10">
                            <p className="font-mono text-foreground">{h.url}</p>
                            <p className="mt-0.5 text-muted-foreground">{fields}</p>
                          </div>
                        );
                      }}
                    />

                    {/* Empty diff state */}
                    {compareData.diff.hosts_discovered_in_b.length === 0 &&
                     compareData.diff.hosts_gone_in_b.length === 0 &&
                     compareData.diff.hosts_changed_in_b.length === 0 && (
                      <p className="text-center text-xs text-muted-foreground py-2">
                        No host changes detected between these two scans.
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            )}

            {sessionA && sessionB && sessionA === sessionB && (
              <p className="text-xs text-muted-foreground">Select two different scans.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
