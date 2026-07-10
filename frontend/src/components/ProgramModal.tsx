import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ShieldCheck, ShieldAlert, HelpCircle,
  Loader2, X, FolderPlus, Pencil, Bell,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScanModeSelector, type ScanMode, type ScheduleSubMode } from "@/components/ScanModeSelector";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { Program, PipelineTemplate, NotifyScope } from "@/types/api";

interface Props {
  /** When set, the modal edits this program; otherwise it creates a new one. */
  program?: Program | null;
  open: boolean;
  onClose: () => void;
  onSaved: (p: Program) => void;
}

type WildcardPolicy = "skip" | "force" | "ask";

const WILDCARD_CARDS: { id: WildcardPolicy; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: "skip",  label: "Skip",  desc: "Ignore wildcard subdomains — safest option",       icon: <ShieldCheck className="h-5 w-5" /> },
  { id: "force", label: "Force", desc: "Process them anyway — may include false positives", icon: <ShieldAlert  className="h-5 w-5" /> },
  { id: "ask",   label: "Ask",   desc: "Pause the scan and let you decide",                 icon: <HelpCircle   className="h-5 w-5" /> },
];

const NOTIFY_CARDS: { id: NotifyScope; label: string; desc: string }[] = [
  { id: "program", label: "Program", desc: "one summary per program scan" },
  { id: "asset",   label: "Asset",   desc: "notify per asset" },
];

export function ProgramModal({ program, open, onClose, onSaved }: Props) {
  const isEdit = !!program;

  const [name,            setName]            = useState(program?.name ?? "");
  const [description,     setDescription]     = useState(program?.description ?? "");
  const [notifyScope,     setNotifyScope]     = useState<NotifyScope>(program?.notify_scope ?? "program");
  const [pipelineTemplate, setPipelineTemplate] = useState(program?.pipeline_template ?? "standard");
  const [wildcardPolicy,  setWildcardPolicy]  = useState<WildcardPolicy>(program?.wildcard_policy ?? "skip");
  const [priority,        setPriority]        = useState(program?.scan_priority ?? 5);
  const [scanMode,        setScanMode]        = useState<ScanMode>(
    program?.loop ? "loop" : program?.manual_only ? "manual" : "schedule"
  );
  const [scheduleSubMode, setScheduleSubMode] = useState<ScheduleSubMode>(program?.schedule_mode ?? "hourly");
  const [rescanInterval,  setRescanInterval]  = useState(program?.rescan_interval ?? 24);
  const [scheduleDays,    setScheduleDays]    = useState(program?.schedule_days ?? 1);
  const [scheduleWeekday, setScheduleWeekday] = useState(program?.schedule_weekday ?? 0);
  const [scheduleHour,    setScheduleHour]    = useState(program?.schedule_hour ?? 0);
  const [scheduleMinute,  setScheduleMinute]  = useState(program?.schedule_minute ?? 0);
  const [retentionRuns,   setRetentionRuns]   = useState(program?.retention_runs ?? 10);
  const [templates,       setTemplates]       = useState<PipelineTemplate[]>([]);

  const { actionFetch, pending: saving } = useActionFetch();

  useEffect(() => {
    setName(program?.name ?? "");
    setDescription(program?.description ?? "");
    setNotifyScope(program?.notify_scope ?? "program");
    setPipelineTemplate(program?.pipeline_template ?? "standard");
    setWildcardPolicy(program?.wildcard_policy ?? "skip");
    setPriority(program?.scan_priority ?? 5);
    setScanMode(program?.loop ? "loop" : program?.manual_only ? "manual" : "schedule");
    setScheduleSubMode(program?.schedule_mode ?? "hourly");
    setRescanInterval(program?.rescan_interval ?? 24);
    setScheduleDays(program?.schedule_days ?? 1);
    setScheduleWeekday(program?.schedule_weekday ?? 0);
    setScheduleHour(program?.schedule_hour ?? 0);
    setScheduleMinute(program?.schedule_minute ?? 0);
    setRetentionRuns(program?.retention_runs ?? 10);
  }, [program]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/v1/pipeline/templates")
      .then((r) => (r.ok ? r.json() as Promise<PipelineTemplate[]> : Promise.reject()))
      .then((data) => { if (!cancelled) setTemplates(data); })
      .catch(() => { /* keep empty list */ });
    return () => { cancelled = true; };
  }, [open]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const body = {
      name:             trimmed,
      description:      description.trim() || null,
      notify_scope:     notifyScope,
      pipeline_template: pipelineTemplate,
      scan_priority:    priority,
      wildcard_policy:  wildcardPolicy,
      loop:             scanMode === "loop",
      manual_only:      scanMode === "manual",
      rescan_interval:  rescanInterval,
      retention_runs:   retentionRuns,
      schedule_mode:    scheduleSubMode,
      schedule_days:    scheduleDays,
      schedule_weekday: scheduleWeekday,
      schedule_hour:    scheduleHour,
      schedule_minute:  scheduleMinute,
    };

    const res = await actionFetch(
      isEdit ? `/api/v1/programs/${program.id}` : "/api/v1/programs",
      {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        successMessage: isEdit ? "Program updated" : "Program created",
        errorPrefix: isEdit ? "Save program" : "Create program",
      },
    );
    if (!res) return;
    const saved = (await res.json()) as Program;
    onSaved(saved);
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!saving && !o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          "data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2",
          "data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-top-[48%]",
          "max-h-[90vh] overflow-y-auto",
        )}>
          <Dialog.Close
            disabled={saving}
            className="absolute right-4 top-4 rounded p-1 text-muted-foreground/50 hover:text-muted-foreground disabled:pointer-events-none transition-colors"
          >
            <X className="h-4 w-4" />
          </Dialog.Close>

          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              {isEdit ? <Pencil className="h-4 w-4 text-primary" /> : <FolderPlus className="h-4 w-4 text-primary" />}
            </div>
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">
                {isEdit ? "Edit Program" : "New Program"}
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                {isEdit ? program.name : "Group wildcard assets into a program"}
              </Dialog.Description>
            </div>
          </div>

          <div className="space-y-5">

            {/* Name */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp bug bounty"
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Scope notes, program URL, etc."
                className="w-full resize-none rounded border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Notify scope */}
            <div>
              <label className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <Bell className="h-3.5 w-3.5" /> Notification scope
              </label>
              <div className="grid grid-cols-2 gap-2">
                {NOTIFY_CARDS.map((n) => {
                  const selected = notifyScope === n.id;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setNotifyScope(n.id)}
                      className={cn(
                        "flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-all",
                        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      <span className={cn("text-xs font-medium", selected ? "text-primary" : "text-foreground")}>{n.label}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground">{n.desc}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                program = one summary per program scan; asset = notify per asset
              </p>
            </div>

            {/* Pipeline template */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">Pipeline template</label>
              <select
                value={pipelineTemplate}
                onChange={(e) => setPipelineTemplate(e.target.value)}
                className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {templates.length === 0 && <option value={pipelineTemplate}>{pipelineTemplate}</option>}
                {templates.map((t) => (
                  <option key={t.id} value={t.name}>{t.display_name}</option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Default pipeline applied to member assets that inherit config
              </p>
            </div>

            {/* Wildcard policy */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">Wildcard Policy</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {WILDCARD_CARDS.map((w) => {
                  const selected = wildcardPolicy === w.id;
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => setWildcardPolicy(w.id)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all",
                        selected ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
                      )}
                    >
                      <span className={selected ? "text-primary" : "text-muted-foreground"}>{w.icon}</span>
                      <span className={cn("text-xs font-medium", selected ? "text-primary" : "text-foreground")}>{w.label}</span>
                      <span className="text-[10px] leading-tight text-muted-foreground">{w.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Priority */}
            <div>
              <label className="mb-2 flex items-center justify-between text-xs font-medium text-foreground">
                <span>Scan Priority</span>
                <span className="text-muted-foreground">{priority} / 10</span>
              </label>
              <input
                type="range" min={1} max={10} value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-full"
              />
            </div>

            {/* Scan mode */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">Scan Mode</label>
              <ScanModeSelector
                mode={scanMode}
                scheduleSubMode={scheduleSubMode}
                rescanInterval={rescanInterval}
                scheduleDays={scheduleDays}
                scheduleWeekday={scheduleWeekday}
                scheduleHour={scheduleHour}
                scheduleMinute={scheduleMinute}
                retentionRuns={retentionRuns}
                onChange={(u) => {
                  if (u.mode !== undefined) setScanMode(u.mode);
                  if (u.scheduleSubMode !== undefined) setScheduleSubMode(u.scheduleSubMode);
                  if (u.rescanInterval !== undefined) setRescanInterval(u.rescanInterval);
                  if (u.scheduleDays !== undefined) setScheduleDays(u.scheduleDays);
                  if (u.scheduleWeekday !== undefined) setScheduleWeekday(u.scheduleWeekday);
                  if (u.scheduleHour !== undefined) setScheduleHour(u.scheduleHour);
                  if (u.scheduleMinute !== undefined) setScheduleMinute(u.scheduleMinute);
                  if (u.retentionRuns !== undefined) setRetentionRuns(u.retentionRuns);
                }}
              />
            </div>

          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded border border-border bg-background px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !name.trim()}
              className="flex items-center gap-2 rounded bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : (
                <>{isEdit ? "Save changes" : "Create program"}</>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
