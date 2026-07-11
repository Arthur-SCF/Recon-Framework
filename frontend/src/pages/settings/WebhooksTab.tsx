import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { WebhookChannel } from "@/types/api";

const ALL_EVENTS = [
  { id: "new_hosts",     label: "New hosts" },
  { id: "host_changed",  label: "Host changed" },
  { id: "host_gone",     label: "Host gone" },
  { id: "scan_complete", label: "Scan complete" },
  { id: "scan_error",    label: "Scan error" },
];

const TYPE_LABELS: Record<string, string> = {
  discord: "Discord",
  slack:   "Slack",
  generic: "Generic",
};

interface NewChannelForm {
  type: "discord" | "slack" | "generic";
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

interface EditChannelForm {
  name: string;
  url: string;
  events: string[];
}

const EMPTY_FORM: NewChannelForm = {
  type: "discord",
  name: "",
  url: "",
  events: ALL_EVENTS.map((e) => e.id),
  enabled: true,
};

export function WebhooksTab() {
  const [channels, setChannels]       = useState<WebhookChannel[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showForm, setShowForm]       = useState(false);
  const [form, setForm]               = useState<NewChannelForm>(EMPTY_FORM);
  const [testingId, setTestingId]     = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; msg: string }>>({});
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expanded, setExpanded]       = useState<Record<string, boolean>>({});
  const [editingId, setEditingId]     = useState<string | null>(null);
  const [editForm, setEditForm]       = useState<EditChannelForm>({ name: "", url: "", events: [] });
  const [editSaving, setEditSaving]   = useState(false);
  const { actionFetch, pending: saving } = useActionFetch();

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/webhooks");
      if (res.ok) setChannels((await res.json()) as WebhookChannel[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchChannels(); }, [fetchChannels]);

  async function handleCreate() {
    if (!form.name.trim() || !form.url.trim()) return;
    const res = await actionFetch("/api/v1/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
      errorPrefix: "Create webhook",
      successMessage: "Webhook channel added",
    });
    if (!res) return;
    setShowForm(false);
    setForm(EMPTY_FORM);
    await fetchChannels();
  }

  async function handleToggle(ch: WebhookChannel) {
    const res = await actionFetch(`/api/v1/webhooks/${ch.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !ch.enabled }),
      errorPrefix: "Toggle webhook",
    });
    if (!res) return;
    await fetchChannels();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await actionFetch(`/api/v1/webhooks/${id}`, {
        method: "DELETE",
        errorPrefix: "Delete webhook",
        successMessage: "Webhook channel deleted",
      });
      if (!res) return;
      await fetchChannels();
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    setTestResults((p) => ({ ...p, [id]: { success: false, msg: "Testing…" } }));
    try {
      const res = await actionFetch(`/api/v1/webhooks/${id}/test`, {
        method: "POST",
        errorPrefix: "Test webhook",
      });
      if (res) {
        const data = await res.json() as { success: boolean; status_code?: number; error?: string };
        setTestResults((p) => ({
          ...p,
          [id]: {
            success: data.success,
            msg: data.success
              ? `Delivered (${data.status_code ?? "OK"})`
              : (data.error ?? `HTTP ${data.status_code}`),
          },
        }));
      } else {
        setTestResults((p) => ({ ...p, [id]: { success: false, msg: "Request failed" } }));
      }
    } finally {
      setTestingId(null);
    }
  }

  function toggleEvent(eventId: string) {
    setForm((f) => ({
      ...f,
      events: f.events.includes(eventId)
        ? f.events.filter((e) => e !== eventId)
        : [...f.events, eventId],
    }));
  }

  function openEdit(ch: WebhookChannel) {
    setEditingId(ch.id);
    setEditForm({ name: ch.name, url: "", events: [...ch.events] });
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function toggleEditEvent(eventId: string) {
    setEditForm((f) => ({
      ...f,
      events: f.events.includes(eventId)
        ? f.events.filter((e) => e !== eventId)
        : [...f.events, eventId],
    }));
  }

  async function handleEditSave(id: string) {
    if (!editForm.name.trim()) return;
    setEditSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: editForm.name.trim(),
        events: editForm.events,
      };
      if (editForm.url.trim()) {
        body.url = editForm.url.trim();
      }
      const res = await actionFetch(`/api/v1/webhooks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        errorPrefix: "Save webhook",
        successMessage: "Webhook channel updated",
      });
      if (!res) return;
      setEditingId(null);
      await fetchChannels();
    } finally {
      setEditSaving(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">Webhook Channels</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Send notifications to Discord, Slack, or any HTTP endpoint.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
            showForm
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Channel
        </button>
      </div>

      {/* Add-channel form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
          <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
            New Channel
          </h3>

          {/* Type + Name */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex flex-col gap-1">
              <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as NewChannelForm["type"] }))}
                className="rounded-md border border-border bg-input px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="generic">Generic</option>
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="My Discord server"
                className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          {/* URL */}
          <div className="flex flex-col gap-1">
            <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Webhook URL</label>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://discord.com/api/webhooks/…"
              className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
            />
          </div>

          {/* Events */}
          <div className="flex flex-col gap-1.5">
            <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Events</label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((ev) => (
                <label key={ev.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="h-3 w-3 accent-primary"
                  />
                  {ev.label}
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); }}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleCreate()}
              disabled={saving || !form.name.trim() || !form.url.trim()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50 transition-opacity"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              Add Channel
            </button>
          </div>
        </div>
      )}

      {/* Channels list */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No webhook channels configured. Add one to receive notifications in external services.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {channels.map((ch) => {
            const result = testResults[ch.id];
            const isOpen = expanded[ch.id] ?? false;
            return (
              <div key={ch.id} className="rounded-lg border border-border bg-card overflow-hidden">
                {/* Row */}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <button
                    onClick={() => setExpanded((p) => ({ ...p, [ch.id]: !isOpen }))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isOpen
                      ? <ChevronDown className="h-3.5 w-3.5" />
                      : <ChevronRight className="h-3.5 w-3.5" />}
                  </button>

                  <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {TYPE_LABELS[ch.type]}
                  </span>

                  <span className="flex-1 text-sm font-medium text-foreground truncate">{ch.name}</span>

                  {/* Enabled toggle */}
                  <button
                    onClick={() => void handleToggle(ch)}
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors shrink-0",
                      ch.enabled ? "bg-primary" : "bg-muted",
                    )}
                    title={ch.enabled ? "Disable" : "Enable"}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 left-0.5 h-4 w-4 rounded-full toggle-thumb transition-transform",
                        ch.enabled && "translate-x-4",
                      )}
                    />
                  </button>

                  {/* Edit button */}
                  <button
                    onClick={() => editingId === ch.id ? cancelEdit() : openEdit(ch)}
                    title="Edit channel"
                    className={cn(
                      "rounded p-1 transition-colors",
                      editingId === ch.id
                        ? "text-primary hover:text-primary/80"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>

                  {/* Test button */}
                  <button
                    onClick={() => void handleTest(ch.id)}
                    disabled={testingId === ch.id}
                    title="Send test payload"
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {testingId === ch.id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Zap className="h-3 w-3" />}
                    Test
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => setConfirmDeleteId(ch.id)}
                    disabled={deletingId === ch.id}
                    title="Delete channel"
                    className="rounded p-1 text-muted-foreground hover:text-sev-critical transition-colors disabled:opacity-50"
                  >
                    {deletingId === ch.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>

                {/* Test result inline */}
                {result && (
                  <div className={cn(
                    "flex items-center gap-1.5 border-t border-border px-4 py-1.5 text-[10px]",
                    result.success ? "text-sev-low" : "text-sev-critical",
                  )}>
                    {result.success && <CheckCircle2 className="h-3 w-3" />}
                    {result.msg}
                  </div>
                )}

                {/* Inline edit form */}
                {editingId === ch.id && (
                  <div className="border-t border-border px-4 py-3 flex flex-col gap-3">
                    <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
                      Edit Channel
                    </p>

                    {/* Name */}
                    <div className="flex flex-col gap-1">
                      <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Name</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    {/* URL */}
                    <div className="flex flex-col gap-1">
                      <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">
                        Webhook URL <span className="normal-case">(leave blank to keep current)</span>
                      </label>
                      <input
                        type="url"
                        value={editForm.url}
                        onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                        placeholder="https://…"
                        className="rounded-md border border-border bg-input px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/50 font-mono"
                      />
                    </div>

                    {/* Events */}
                    <div className="flex flex-col gap-1.5">
                      <label className="font-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Events</label>
                      <div className="flex flex-wrap gap-2">
                        {ALL_EVENTS.map((ev) => (
                          <label key={ev.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                            <input
                              type="checkbox"
                              checked={editForm.events.includes(ev.id)}
                              onChange={() => toggleEditEvent(ev.id)}
                              className="h-3 w-3 accent-primary"
                            />
                            {ev.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => void handleEditSave(ch.id)}
                        disabled={editSaving || !editForm.name.trim()}
                        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50 transition-opacity"
                      >
                        {editSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                        Save
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Expanded: events */}
                {isOpen && editingId !== ch.id && (
                  <div className="border-t border-border px-4 py-2.5 flex flex-wrap gap-2">
                    {ALL_EVENTS.map((ev) => (
                      <span
                        key={ev.id}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-mono",
                          ch.events.includes(ev.id)
                            ? "bg-sev-low/15 text-sev-low"
                            : "bg-muted/20 text-muted-foreground line-through",
                        )}
                      >
                        {ev.id}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation */}
      {(() => {
        const ch = channels.find((c) => c.id === confirmDeleteId);
        return (
          <DeleteConfirmDialog
            open={confirmDeleteId !== null}
            onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}
            itemName={ch?.name ?? ""}
            itemType="webhook channel"
            onConfirm={() => handleDelete(confirmDeleteId!)}
            loading={deletingId !== null}
          />
        );
      })()}
    </div>
  );
}
