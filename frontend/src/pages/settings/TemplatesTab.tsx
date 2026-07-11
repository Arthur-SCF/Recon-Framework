import { useCallback, useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { TemplateEditor } from "@/components/TemplateEditor";
import type { PipelineTemplate, PipelineTemplateFull } from "@/types/api";

interface TemplateDialogState {
  open: boolean;
  mode: "create" | "edit";
  template: PipelineTemplateFull | null;
}

export function TemplatesTab() {
  const [templates,     setTemplates]     = useState<PipelineTemplate[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [cloning,       setCloning]       = useState<string | null>(null);
  const [deleting,      setDeleting]      = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PipelineTemplate | null>(null);
  const [dialog,        setDialog]        = useState<TemplateDialogState>({ open: false, mode: "create", template: null });
  const { actionFetch } = useActionFetch();

  const load = useCallback(() => {
    setLoading(true);
    void fetch("/api/v1/pipeline/templates")
      .then((r) => (r.ok ? (r.json() as Promise<PipelineTemplate[]>) : Promise.reject()))
      .then((data) => { setTemplates(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openCreate() {
    const listRes = await fetch("/api/v1/pipeline/templates").then((r) => r.json() as Promise<PipelineTemplate[]>);
    const standard = listRes.find((t) => t.is_default) ?? listRes[0];
    if (!standard) {
      setDialog({ open: true, mode: "create", template: { id: "", name: "", display_name: "", description: null, is_default: false, config: { groups: [] } } });
      return;
    }
    const full = await fetch(`/api/v1/pipeline/templates/${standard.id}`).then((r) => r.json() as Promise<PipelineTemplateFull>);
    setDialog({ open: true, mode: "create", template: { ...full, id: "", name: "", display_name: "", description: null, is_default: false } });
  }

  async function openEdit(t: PipelineTemplate) {
    const full = await fetch(`/api/v1/pipeline/templates/${t.id}`).then((r) => r.json() as Promise<PipelineTemplateFull>);
    setDialog({ open: true, mode: "edit", template: full });
  }

  async function handleClone(t: PipelineTemplate) {
    setCloning(t.id);
    try {
      const resp = await actionFetch(`/api/v1/pipeline/templates/${t.id}/clone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        errorPrefix: "Clone template",
        successMessage: "Template cloned",
      });
      if (resp) load();
    } finally {
      setCloning(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const resp = await actionFetch(`/api/v1/pipeline/templates/${pendingDelete.id}`, {
        method: "DELETE",
        errorPrefix: "Delete template",
      });
      if (resp) { setPendingDelete(null); load(); }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="py-6 max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Pipeline Templates</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Built-in templates cannot be modified. Clone them to create a custom variant.
          </p>
        </div>
        <button
          onClick={() => void openCreate()}
          className="flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Template
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-faint-foreground">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.length === 0 && !loading && (
                <tr><td colSpan={4} className="text-center py-8 text-muted-foreground text-sm">
                  No templates found. Create one to get started.
                </td></tr>
              )}
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2 font-mono text-xs text-foreground">{t.display_name}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{t.description || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      "inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide",
                      t.is_default ? "bg-muted/50 text-muted-foreground" : "bg-sev-info/15 text-sev-info",
                    )}>
                      {t.is_default ? "built-in" : "custom"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!t.is_default && (
                        <button onClick={() => void openEdit(t)}
                          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit template">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => void handleClone(t)}
                        disabled={cloning === t.id}
                        className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                        title="Clone template"
                      >
                        {cloning === t.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Copy className="h-3.5 w-3.5" />}
                      </button>
                      {!t.is_default && (
                        <button onClick={() => setPendingDelete(t)} disabled={deleting}
                          className="rounded p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          title="Delete template">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TemplateEditorDialog
        state={dialog}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onSaved={() => { setDialog((d) => ({ ...d, open: false })); load(); }}
      />

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        itemName={pendingDelete?.display_name ?? ""}
        itemType="template"
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </div>
  );
}

// ── Template editor dialog ─────────────────────────────────────────────────────

interface TemplateEditorDialogProps {
  state: TemplateDialogState;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateEditorDialog({ state, onClose, onSaved }: TemplateEditorDialogProps) {
  const { open, mode, template } = state;
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [config,      setConfig]      = useState<PipelineTemplateFull["config"] | null>(null);
  const { actionFetch, pending: saving } = useActionFetch();

  useEffect(() => {
    if (open && template) {
      setDisplayName(template.display_name ?? "");
      setDescription(template.description ?? "");
      setConfig(template.config ?? null);
    }
  }, [open, template]);

  async function handleSave() {
    if (!displayName.trim() || !config) return;
    let resp: Response | null;
    if (mode === "create") {
      const slug = displayName.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
      resp = await actionFetch("/api/v1/pipeline/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:         slug || `custom_${Date.now()}`,
          display_name: displayName.trim(),
          description:  description.trim() || null,
          config,
        }),
        errorPrefix: "Create template",
        successMessage: "Template created",
      });
    } else {
      resp = await actionFetch(`/api/v1/pipeline/templates/${template!.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          description:  description.trim() || null,
          config,
        }),
        errorPrefix: "Save template",
        successMessage: "Template saved",
      });
    }
    if (!resp) return;
    onSaved();
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!saving && !o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "max-h-[90vh] overflow-y-auto",
        )}>
          <Dialog.Close disabled={saving}
            className="absolute right-4 top-4 rounded p-1 text-muted-foreground/50 hover:text-muted-foreground disabled:pointer-events-none transition-colors">
            <X className="h-4 w-4" />
          </Dialog.Close>

          <Dialog.Title className="text-sm font-semibold text-foreground mb-4">
            {mode === "create" ? "New Template" : "Edit Template"}
          </Dialog.Title>

          <div className="space-y-4">
            <div>
              <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="My Custom Template"
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional description…"
                className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div>
              <label className="mb-2 block font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Pipeline Steps</label>
              <TemplateEditor config={config} onChange={setConfig} />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={onClose} disabled={saving}
              className="rounded border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
              Cancel
            </button>
            <button onClick={() => void handleSave()} disabled={saving || !displayName.trim()}
              className="flex items-center gap-2 rounded bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors">
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <>Save</>}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
