import { useCallback, useEffect, useState } from "react";
import { Calendar, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { ReportSchedule, WebhookChannel, Target } from "@/types/api";

const DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface FormState {
  name: string;
  target_id: string;
  frequency: "daily" | "weekly";
  day_of_week: number;
  hour: number;
  channel_id: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  target_id: "",
  frequency: "daily",
  day_of_week: 0,
  hour: 9,
  channel_id: "",
  enabled: true,
};

function formatSchedule(s: ReportSchedule): string {
  const hour = `${String(s.hour).padStart(2, "0")}:00 UTC`;
  if (s.frequency === "weekly" && s.day_of_week !== null) {
    return `Weekly · ${DOW_NAMES[s.day_of_week]} @ ${hour}`;
  }
  return `Daily @ ${hour}`;
}

function formatLastSent(ts: string | null): string {
  if (!ts) return "Never";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function ReportsTab() {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [channels, setChannels] = useState<WebhookChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ReportSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { actionFetch, pending: saving } = useActionFetch();

  const fetchSchedules = useCallback(async () => {
    const res = await fetch("/api/v1/report-schedules");
    if (res.ok) setSchedules(await res.json() as ReportSchedule[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchSchedules();
    fetch("/api/v1/targets").then((r) => r.ok ? r.json() : []).then(setTargets).catch(() => {});
    fetch("/api/v1/webhooks").then((r) => r.ok ? r.json() : []).then(setChannels).catch(() => {});
  }, [fetchSchedules]);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(s: ReportSchedule) {
    setEditId(s.id);
    setForm({
      name: s.name,
      target_id: s.target_id ?? "",
      frequency: s.frequency,
      day_of_week: s.day_of_week ?? 0,
      hour: s.hour,
      channel_id: s.channel_id ?? "",
      enabled: s.enabled,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) return;
    const payload = {
      name: form.name.trim(),
      target_id: form.target_id || null,
      frequency: form.frequency,
      day_of_week: form.frequency === "weekly" ? form.day_of_week : null,
      hour: form.hour,
      channel_id: form.channel_id || null,
      enabled: form.enabled,
    };
    const url = editId ? `/api/v1/report-schedules/${editId}` : "/api/v1/report-schedules";
    const method = editId ? "PUT" : "POST";
    const res = await actionFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      errorPrefix: editId ? "Update schedule" : "Create schedule",
      successMessage: editId ? "Schedule updated." : "Schedule created.",
    });
    if (!res) return;
    setShowForm(false);
    await fetchSchedules();
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await actionFetch(`/api/v1/report-schedules/${id}`, {
        method: "DELETE",
        errorPrefix: "Delete schedule",
        successMessage: "Schedule deleted.",
      });
      if (!res) return;
      setSchedules((prev) => prev.filter((s) => s.id !== id));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggle(s: ReportSchedule) {
    const res = await actionFetch(`/api/v1/report-schedules/${s.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
      errorPrefix: "Toggle schedule",
    });
    if (!res) return;
    await fetchSchedules();
  }

  async function handleRunNow(id: string) {
    setRunningId(id);
    const res = await actionFetch(`/api/v1/report-schedules/${id}/run`, {
      method: "POST",
      errorPrefix: "Run schedule",
      successMessage: "Report dispatched.",
    });
    if (res) await fetchSchedules();
    setRunningId(null);
  }

  return (
    <div className="flex flex-col gap-4 py-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground flex items-center gap-1.5">
          <Calendar className="h-4 w-4" />
          <span>Scheduled Reports</span>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add Schedule
        </button>
      </div>

      {channels.length === 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          No webhook channels configured. Add one in the Webhooks tab first.
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
          <p className="font-medium text-foreground">{editId ? "Edit Schedule" : "New Schedule"}</p>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              placeholder="Weekly digest"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Frequency</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as "daily" | "weekly" }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">UTC Hour (0–23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={form.hour}
                onChange={(e) => setForm((f) => ({ ...f, hour: parseInt(e.target.value) || 0 }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              />
            </div>
          </div>

          {form.frequency === "weekly" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Day of Week</label>
              <select
                value={form.day_of_week}
                onChange={(e) => setForm((f) => ({ ...f, day_of_week: parseInt(e.target.value) }))}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
              >
                {DOW_NAMES.map((d, i) => (
                  <option key={i} value={i}>{d}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Target (optional)</label>
            <select
              value={form.target_id}
              onChange={(e) => setForm((f) => ({ ...f, target_id: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All targets</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>{t.domain}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Channel (optional)</label>
            <select
              value={form.channel_id}
              onChange={(e) => setForm((f) => ({ ...f, channel_id: e.target.value }))}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
            >
              <option value="">All enabled channels</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim()}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : editId ? "Save" : "Create"}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Schedule list */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : schedules.length === 0 ? (
        <p className="text-sm text-muted-foreground italic py-4">
          No schedules yet. Create one to receive automatic digests.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => {
            const targetDomain = targets.find((t) => t.id === s.target_id)?.domain;
            const channelName = channels.find((c) => c.id === s.channel_id)?.name;
            return (
              <div
                key={s.id}
                className={cn(
                  "rounded-lg border border-border bg-card p-3 text-sm",
                  !s.enabled && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground truncate">{s.name}</span>
                      {!s.enabled && (
                        <span className="rounded px-1 py-0.5 text-[9px] bg-muted text-muted-foreground font-medium">
                          DISABLED
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground space-y-0.5">
                      <div>{formatSchedule(s)}</div>
                      <div>
                        Target: <span className="text-foreground">{targetDomain ?? "All targets"}</span>
                        {" · "}Channel: <span className="text-foreground">{channelName ?? "All channels"}</span>
                      </div>
                      <div>Last sent: {formatLastSent(s.last_sent_at)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => void handleRunNow(s.id)}
                      disabled={runningId === s.id}
                      title="Run now"
                      className="rounded p-1.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {runningId === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => openEdit(s)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleToggle(s)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border transition-colors"
                    >
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => setPendingDelete(s)}
                      className="rounded p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
        itemName={pendingDelete?.name ?? ""}
        itemType="schedule"
        onConfirm={() => handleDelete(pendingDelete!.id)}
        loading={deleting}
      />
    </div>
  );
}
