import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertCircle, FolderPlus, FolderKanban, Play, Plus, Trash2, Bell } from "lucide-react";
import { PageTransition } from "@/components/PageTransition";
import { ProgramModal } from "@/components/ProgramModal";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { SkeletonCards } from "@/components/Skeleton";
import { useActionFetch } from "@/hooks/useActionFetch";
import { useToast } from "@/contexts/ToastContext";
import type { Program, ProgramScanResult } from "@/types/api";

export function Programs() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Program | null>(null);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const { actionFetch } = useActionFetch();
  const { addToast } = useToast();

  const fetchPrograms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/programs");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setPrograms((await res.json()) as Program[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load programs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrograms();
  }, [fetchPrograms]);

  function handleCreated(p: Program) {
    setPrograms((prev) => [p, ...prev]);
  }

  async function scanAll(p: Program, e: React.MouseEvent) {
    e.stopPropagation();
    const res = await actionFetch(`/api/v1/programs/${p.id}/scan`, {
      method: "POST",
      errorPrefix: "Scan program",
    });
    if (!res) return;
    const result = (await res.json()) as ProgramScanResult;
    addToast(`Queued ${result.queued} of ${result.asset_total} assets`, "success");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await actionFetch(`/api/v1/programs/${deleteTarget.id}`, {
      method: "DELETE",
      successMessage: "Program deleted",
      errorPrefix: "Delete program",
    });
    setDeleting(false);
    if (!res) return;
    setPrograms((prev) => prev.filter((x) => x.id !== deleteTarget.id));
    setDeleteTarget(null);
  }

  return (
    <PageTransition>
      <div className="flex flex-col gap-5 p-3 sm:p-6 max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Programs</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {programs.length > 0
                ? `${programs.length} program${programs.length !== 1 ? "s" : ""}`
                : "Group wildcard assets into programs"}
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="hidden sm:inline">New Program</span>
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && programs.length === 0 && <SkeletonCards count={6} />}

        {!loading && !error && programs.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
            <FolderKanban className="h-10 w-10 text-muted-foreground/30" />
            <p className="mt-4 text-sm font-medium text-muted-foreground">No programs yet</p>
            <p className="mt-1 text-sm text-muted-foreground/60">
              Create a program to group multiple wildcard assets together.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-6 flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FolderPlus className="h-4 w-4" />
              New Program
            </button>
          </div>
        )}

        {programs.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((p) => (
              <div
                key={p.id}
                onClick={() => navigate(`/program/${p.id}`)}
                className="group flex cursor-pointer flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4 shrink-0 text-primary" />
                      <h3 className="truncate text-sm font-semibold text-foreground">{p.name}</h3>
                    </div>
                    {p.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.description}</p>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                    className="shrink-0 rounded border border-border bg-background p-1.5 text-muted-foreground opacity-0 transition-all hover:border-destructive/50 hover:text-destructive group-hover:opacity-100"
                    title="Delete program"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded-full bg-muted/50 px-2 py-0.5 text-muted-foreground">
                    {p.asset_count} asset{p.asset_count !== 1 ? "s" : ""}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-muted-foreground">
                    <Bell className="h-3 w-3" /> {p.notify_scope}
                  </span>
                  <span className="rounded-full bg-muted/50 px-2 py-0.5 font-mono text-muted-foreground">
                    {p.pipeline_template}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-end border-t border-border/60 pt-3">
                  <button
                    onClick={(e) => void scanAll(p, e)}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Scan all
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <ProgramModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSaved={handleCreated}
        />

        <DeleteConfirmDialog
          open={deleteTarget !== null}
          onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
          itemName={deleteTarget?.name ?? ""}
          itemType="program"
          description="Assets will become standalone targets; their data is kept."
          onConfirm={confirmDelete}
          loading={deleting}
        />
      </div>
    </PageTransition>
  );
}
