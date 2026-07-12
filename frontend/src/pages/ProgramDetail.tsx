import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertTriangle, Bell, Globe, History, Link2, Loader2, Pencil, Play, Plus, ShieldAlert, Target as TargetIcon, Trash2, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/PageTransition";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProgramModal } from "@/components/ProgramModal";
import { AssignAssetsModal } from "@/components/AssignAssetsModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { SubdomainsTable } from "@/components/SubdomainsTable";
import { PortsTable } from "@/components/PortsTable";
import { TakeoverTable } from "@/components/TakeoverTable";
import { ProgramLiveHosts } from "@/components/hosts/ProgramLiveHosts";
import { useActionFetch } from "@/hooks/useActionFetch";
import { useToast } from "@/contexts/ToastContext";
import type { Program, ProgramAsset, ProgramScanResult, ProgramScanSession, ProgramStats } from "@/types/api";

const TABS = [
  { id: "overview",   label: "Overview" },
  { id: "assets",     label: "Assets" },
  { id: "subdomains", label: "Subdomains" },
  { id: "hosts",      label: "Live Hosts" },
  { id: "ports",      label: "Ports" },
  { id: "takeover",   label: "Takeover" },
  { id: "scans",      label: "Scans" },
  { id: "config",     label: "Config" },
];

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ProgramDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { actionFetch } = useActionFetch();
  const { addToast } = useToast();

  const [program, setProgram]   = useState<Program | null>(null);
  const [loading, setLoading]   = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting]     = useState(false);

  const refreshProgram = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`/api/v1/programs/${id}`);
    if (res.ok) setProgram((await res.json()) as Program);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setNotFound(false);
    fetch(`/api/v1/programs/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.ok ? (r.json() as Promise<Program>) : Promise.reject();
      })
      .then((data) => { if (data) setProgram(data); })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleScanAll() {
    if (!id) return;
    const res = await actionFetch(`/api/v1/programs/${id}/scan`, {
      method: "POST",
      errorPrefix: "Scan program",
    });
    if (!res) return;
    const result = (await res.json()) as ProgramScanResult;
    addToast(`Queued ${result.queued} of ${result.asset_total} assets`, "success");
  }

  async function handleDelete() {
    if (!id) return;
    setDeleting(true);
    const res = await actionFetch(`/api/v1/programs/${id}`, {
      method: "DELETE",
      successMessage: "Program deleted",
      errorPrefix: "Delete program",
    });
    setDeleting(false);
    if (!res) return;
    navigate("/programs");
  }

  if (!loading && notFound) {
    return (
      <PageTransition>
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-center">
          <AlertTriangle className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium text-foreground">Program not found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No program with ID <code className="font-mono">{id}</code> exists.
            </p>
          </div>
          <button
            onClick={() => navigate("/programs")}
            className="mt-2 rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to programs
          </button>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-4 p-3 sm:p-6 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-start gap-3">
          {loading ? (
            <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Program</p>
                <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{program?.name ?? "—"}</h1>
                {program && (
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {program.asset_count} asset{program.asset_count !== 1 ? "s" : ""} · notify {program.notify_scope} · {program.pipeline_template}
                  </p>
                )}
                {program?.description && (
                  <p className="mt-1 max-w-xl text-xs text-muted-foreground/80">{program.description}</p>
                )}
              </div>

              {program && (
                <div className="flex flex-wrap items-center gap-2 sm:pt-1">
                  <button
                    onClick={() => void handleScanAll()}
                    className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" /> Scan all
                  </button>
                  <button
                    onClick={() => setEditOpen(true)}
                    className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="Edit program"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="rounded border border-border bg-background p-1.5 text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-colors"
                    title="Delete program"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        {program && id && (
          <Tabs.Root key={id} defaultValue="overview">
            <div className="overflow-x-auto pb-px -mx-0.5 px-0.5">
              <Tabs.List className="flex gap-1 border-b border-border min-w-max">
                {TABS.map(({ id: tabId, label }) => (
                  <Tabs.Trigger
                    key={tabId}
                    value={tabId}
                    className={cn(
                      "px-3 py-2 text-[13px] transition-colors border-b-2 -mb-px whitespace-nowrap",
                      "text-muted-foreground border-transparent",
                      "data-[state=active]:text-foreground data-[state=active]:border-primary",
                      "hover:text-foreground",
                    )}
                  >
                    {label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
            </div>

            <Tabs.Content value="overview" className="pt-4">
              <ErrorBoundary label="Overview">
                <StatsPanel programId={id} />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="assets" className="pt-4">
              <ErrorBoundary label="Assets">
                <AssetsPanel
                  programId={id}
                  onOpenAssign={() => setAssignOpen(true)}
                  onChanged={() => void refreshProgram()}
                />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="subdomains" className="pt-4">
              <ErrorBoundary label="Subdomains">
                <SubdomainsTable endpointBase={`/programs/${id}`} showAsset />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="hosts" className="pt-4">
              <ErrorBoundary label="Live Hosts">
                <ProgramLiveHosts programId={id} />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="ports" className="pt-4">
              <ErrorBoundary label="Ports">
                <PortsTable endpointBase={`/programs/${id}`} showAsset />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="takeover" className="pt-4">
              <ErrorBoundary label="Takeover">
                <TakeoverTable endpointBase={`/programs/${id}`} showAsset />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="scans" className="pt-4">
              <ErrorBoundary label="Scans">
                <ScansPanel programId={id} />
              </ErrorBoundary>
            </Tabs.Content>

            <Tabs.Content value="config" className="pt-4">
              <ErrorBoundary label="Config">
                <ConfigPanel program={program} onEdit={() => setEditOpen(true)} />
              </ErrorBoundary>
            </Tabs.Content>
          </Tabs.Root>
        )}
      </div>

      {program && (
        <ProgramModal
          program={program}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => setProgram(updated)}
        />
      )}

      {id && (
        <AssignAssetsModal
          programId={id}
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          onAssigned={(r) => {
            if (r.not_found.length > 0) {
              addToast(`${r.not_found.length} target(s) not found`, "error");
            }
            void refreshProgram();
          }}
        />
      )}

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        itemName={program?.name ?? ""}
        itemType="program"
        description="Assets will become standalone targets; their data is kept."
        onConfirm={handleDelete}
        loading={deleting}
      />
    </PageTransition>
  );
}

/* ── Stats panel ── */
function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg border border-border bg-card p-4 border-l-[3px]", accent)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums text-foreground">{value.toLocaleString()}</p>
          <p className="mt-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">{label}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-2 text-muted-foreground">{icon}</div>
      </div>
    </div>
  );
}

function StatsPanel({ programId }: { programId: string }) {
  const [stats, setStats] = useState<ProgramStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/programs/${programId}/stats`)
      .then((r) => (r.ok ? r.json() as Promise<ProgramStats> : Promise.reject()))
      .then((d) => { if (!cancelled) setStats(d); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [programId]);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!stats) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No stats available yet.</p>;
  }

  const maxCount = Math.max(1, ...stats.status_dist.map((s) => s.count));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Assets"     value={stats.totals.assets}     icon={<TargetIcon className="h-4 w-4" />} accent="border-l-primary" />
        <StatCard label="Subdomains" value={stats.totals.subdomains} icon={<Globe className="h-4 w-4" />}      accent="border-l-sev-info" />
        <StatCard label="Live Hosts" value={stats.totals.hosts}      icon={<Globe className="h-4 w-4" />}      accent="border-l-sev-low" />
        <StatCard label="Takeovers"  value={stats.totals.takeovers}  icon={<ShieldAlert className="h-4 w-4" />} accent="border-l-sev-medium" />
      </div>

      {/* Per-asset breakdown */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Per-asset breakdown</p>
        {stats.by_asset.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No assets yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2 font-medium text-muted-foreground">Asset</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground text-right">Subdomains</th>
                  <th className="px-3 py-2 font-medium text-muted-foreground text-right">Live Hosts</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_asset.map((a) => (
                  <tr key={a.target_id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2">
                      <Link to={`/target/${a.target_id}`} className="font-mono text-primary hover:underline">{a.domain}</Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{a.subdomains.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{a.hosts.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status distribution */}
      {stats.status_dist.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Status distribution</p>
          <div className="flex flex-col gap-2">
            {stats.status_dist.map((s) => (
              <div key={s.bucket} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{s.bucket}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/40">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{s.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Assets panel ── */
function AssetsPanel({ programId, onOpenAssign, onChanged }: {
  programId: string;
  onOpenAssign: () => void;
  onChanged: () => void;
}) {
  const [assets, setAssets] = useState<ProgramAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { actionFetch } = useActionFetch();

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/v1/programs/${programId}/assets`)
      .then((r) => (r.ok ? r.json() as Promise<ProgramAsset[]> : Promise.reject()))
      .then(setAssets)
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [programId]);

  useEffect(() => { load(); }, [load]);

  async function createTarget() {
    const domain = newDomain.trim();
    if (!domain) return;
    setSubmitting(true);
    const res = await actionFetch(`/api/v1/programs/${programId}/targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
      successMessage: "Target created (inherits program config)",
      errorPrefix: "Create target",
    });
    setSubmitting(false);
    if (!res) return;
    setNewDomain("");
    setCreating(false);
    load();
    onChanged();
  }

  async function unassign(targetId: string) {
    setUnassigning(targetId);
    const res = await actionFetch(`/api/v1/programs/${programId}/assets/${targetId}`, {
      method: "DELETE",
      successMessage: "Asset unassigned",
      errorPrefix: "Unassign asset",
    });
    setUnassigning(null);
    if (!res) return;
    setAssets((prev) => prev.filter((a) => a.id !== targetId));
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {assets.length} asset{assets.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => setCreating((v) => !v)}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> New target
        </button>
        <button
          onClick={onOpenAssign}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Link2 className="h-3.5 w-3.5" /> Assign assets
        </button>
      </div>

      {creating && (
        <form
          onSubmit={(e) => { e.preventDefault(); void createTarget(); }}
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 p-2"
        >
          <input
            autoFocus
            type="text"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="example.com — new asset inherits this program's config"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={submitting || !newDomain.trim()}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setNewDomain(""); }}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : assets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
          <Link2 className="h-8 w-8 opacity-30" />
          <span>No assets assigned yet.</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-3 py-2 font-medium text-muted-foreground">Asset</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Config</th>
                <th className="px-3 py-2 font-medium text-muted-foreground">Last scan</th>
                <th className="px-3 py-2 font-medium text-muted-foreground text-right">Scans</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2">
                    <Link to={`/target/${a.id}`} className="font-mono text-primary hover:underline">{a.domain}</Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">{a.status}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                      a.config_source === "inherit" ? "bg-sev-info/15 text-sev-info" : "bg-sev-medium/15 text-sev-medium",
                    )}>
                      {a.config_source}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">{relativeTime(a.last_scan_at)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-foreground">{a.scan_count}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => void unassign(a.id)}
                      disabled={unassigning === a.id}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-colors disabled:opacity-50"
                      title="Unassign asset"
                    >
                      <Unlink className="h-3 w-3" /> Unassign
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Scans panel ── */
function ScanStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    running:   "bg-sev-info/15 text-sev-info",
    completed: "bg-sev-low/15 text-sev-low",
    cancelled: "bg-sev-medium/15 text-sev-medium",
  };
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
      styles[status] ?? "bg-muted/40 text-muted-foreground",
    )}>
      {status === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {status}
    </span>
  );
}

function ScanStat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("font-mono font-semibold tabular-nums", accent)}>{value.toLocaleString()}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function ScansPanel({ programId }: { programId: string }) {
  const [runs, setRuns] = useState<ProgramScanSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      fetch(`/api/v1/programs/${programId}/scan-sessions`)
        .then((r) => (r.ok ? r.json() as Promise<ProgramScanSession[]> : Promise.reject()))
        .then((data) => {
          if (cancelled) return;
          setRuns(data);
          if (data.some((d) => d.status === "running")) {
            timer = setTimeout(load, 5000);
          }
        })
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    setLoading(true);
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [programId]);

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (runs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
        <History className="h-8 w-8 opacity-30" />
        <span>No program scans yet.</span>
        <span className="text-xs">Use “Scan all” to run every asset as one program scan.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {runs.map((run) => {
        const pct = run.asset_total > 0 ? (run.asset_done / run.asset_total) * 100 : 0;
        const s = run.stats ?? {};
        return (
          <div key={run.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ScanStatusBadge status={run.status} />
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  started {relativeTime(run.started_at)}
                  {run.finished_at && ` · finished ${relativeTime(run.finished_at)}`}
                </span>
              </div>
              <span className="font-mono text-xs tabular-nums text-foreground">
                {run.asset_done} / {run.asset_total} assets
              </span>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn("h-full rounded-full transition-all", run.status === "running" ? "bg-sev-info" : "bg-primary")}
                style={{ width: `${pct}%` }}
              />
            </div>

            {run.status !== "running" && (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <ScanStat label="discovered" value={s.discovered ?? 0}     accent="text-sev-low" />
                <ScanStat label="changed"    value={s.changed ?? 0}        accent="text-sev-info" />
                <ScanStat label="gone"       value={s.gone ?? 0}           accent="text-sev-critical" />
                <ScanStat label="new subs"   value={s.new_subdomains ?? 0} accent="text-foreground" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Config panel ── */
function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-[11px] tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ConfigPanel({ program, onEdit }: { program: Program; onEdit: () => void }) {
  const scanMode = program.loop ? "Loop" : program.manual_only ? "Manual" : "Schedule";
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-faint-foreground uppercase tracking-[0.14em]">
            <Bell className="h-3.5 w-3.5" /> Default configuration
          </p>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
        <ConfigRow label="Notification scope" value={program.notify_scope} />
        <ConfigRow label="Pipeline template"  value={program.pipeline_template} />
        <ConfigRow label="Wildcard policy"    value={program.wildcard_policy} />
        <ConfigRow label="Scan mode"          value={scanMode} />
        <ConfigRow label="Scan priority"      value={`${program.scan_priority} / 10`} />
        <ConfigRow label="Rescan interval"    value={`${program.rescan_interval}h`} />
        <ConfigRow label="Retention"          value={`${program.retention_runs} scans`} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        program = one summary per program scan; asset = notify per asset
      </p>
    </div>
  );
}
