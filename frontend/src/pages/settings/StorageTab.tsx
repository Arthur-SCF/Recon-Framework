import { useCallback, useEffect, useState } from "react";
import { Database, HardDrive, Loader2, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { BackupEntry, StorageStats } from "@/types/api";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function StorageTab() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [pendingDeleteBackup, setPendingDeleteBackup] = useState<string | null>(null);
  const [deletingBackup, setDeletingBackup] = useState(false);
  const { actionFetch } = useActionFetch();

  const fetchStats = useCallback(async () => {
    const res = await fetch("/api/v1/settings/storage");
    if (res.ok) setStats((await res.json()) as StorageStats);
    setLoading(false);
  }, []);

  const fetchBackups = useCallback(async () => {
    const res = await fetch("/api/v1/settings/backup");
    if (res.ok) setBackups((await res.json()) as BackupEntry[]);
  }, []);

  useEffect(() => {
    void fetchStats();
    void fetchBackups();
    const interval = setInterval(() => void fetchStats(), 30_000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchBackups]);

  async function createBackup() {
    setBackupCreating(true);
    setBackupMsg(null);
    const res = await actionFetch("/api/v1/settings/backup", {
      method: "POST",
      errorPrefix: "Create backup",
    });
    if (res) {
      setBackupMsg("Backup created.");
      await fetchBackups();
    } else {
      setBackupMsg("Backup failed.");
    }
    setBackupCreating(false);
  }

  async function deleteBackup(filename: string) {
    setDeletingBackup(true);
    try {
      const res = await actionFetch(`/api/v1/settings/backup/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        errorPrefix: "Delete backup",
        successMessage: "Backup deleted.",
      });
      if (!res) return;
      setPendingDeleteBackup(null);
      await fetchBackups();
    } finally {
      setDeletingBackup(false);
    }
  }

  async function runCleanup() {
    setCleaning(true);
    setCleanMsg(null);
    const res = await actionFetch("/api/v1/settings/storage/cleanup", {
      method: "POST",
      errorPrefix: "Run cleanup",
    });
    if (res) {
      const data = (await res.json()) as { cleaned_sessions: number };
      setCleanMsg(`Cleaned ${data.cleaned_sessions} session(s).`);
      await fetchStats();
    } else {
      setCleanMsg("Cleanup failed.");
    }
    setCleaning(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Failed to load storage stats.
      </p>
    );
  }

  const pct = Math.min(stats.used_pct, 100);
  const barColor = pct >= 90 ? "bg-destructive" : pct >= 75 ? "bg-yellow-400" : "bg-primary";

  return (
    <div className="py-6 max-w-lg space-y-6">
      {/* Disk usage */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <HardDrive className="h-4 w-4" />
            Disk Usage
          </h3>
          <span className="text-xs text-muted-foreground">
            {formatBytes(stats.used_bytes)} / {formatBytes(stats.total_bytes)}
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {pct.toFixed(1)}% used · {formatBytes(stats.free_bytes)} free
        </p>
      </section>

      {/* Per-target usage */}
      {stats.targets.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Per-Target Usage</h3>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  <th className="px-3 py-2 text-muted-foreground font-medium">Target</th>
                  <th className="px-3 py-2 text-muted-foreground font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.targets]
                  .sort((a, b) => b.used_bytes - a.used_bytes)
                  .map((t) => (
                    <tr key={t.domain} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-mono text-foreground">{t.domain}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{formatBytes(t.used_bytes)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Cleanup */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Cleanup</h3>
        <p className="text-xs text-muted-foreground">
          Remove old scan data beyond each target's retention limit.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void runCleanup()}
            disabled={cleaning}
            className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {cleaning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Run Cleanup
          </button>
          {cleanMsg && <p className="text-xs text-muted-foreground">{cleanMsg}</p>}
        </div>
      </section>

      {/* Database Backups */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <Database className="h-4 w-4" />
            Database Backups
          </h3>
          <button
            onClick={() => void createBackup()}
            disabled={backupCreating}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            {backupCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Create Backup
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Hot backups of recon.db. Auto-created after each scan. Last 10 kept.
        </p>
        {backupMsg && <p className="text-xs text-muted-foreground">{backupMsg}</p>}
        {backups.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No backups yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {backups.map((b) => (
              <div
                key={b.filename}
                className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/50 last:border-0 text-xs"
              >
                <span className="font-mono text-foreground truncate flex-1">{b.filename}</span>
                <span className="text-muted-foreground shrink-0">{formatBytes(b.size_bytes)}</span>
                <button
                  onClick={() => setPendingDeleteBackup(b.filename)}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title="Delete backup"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <DeleteConfirmDialog
        open={pendingDeleteBackup !== null}
        onOpenChange={(o) => { if (!o) setPendingDeleteBackup(null); }}
        itemName={pendingDeleteBackup ?? ""}
        itemType="backup"
        description="This cannot be undone."
        onConfirm={() => { if (pendingDeleteBackup) deleteBackup(pendingDeleteBackup); }}
        loading={deletingBackup}
      />
    </div>
  );
}
