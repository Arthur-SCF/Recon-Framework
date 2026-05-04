import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ShieldCheck, ShieldAlert, HelpCircle,
  Loader2, X, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TagInput } from "@/components/TagInput";
import { ScanModeSelector, type ScanMode, type ScheduleSubMode } from "@/components/ScanModeSelector";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { Target } from "@/types/api";

interface Props {
  target: Target;
  open: boolean;
  onClose: () => void;
  onUpdated: (t: Target) => void;
}

type WildcardPolicy = "skip" | "force" | "ask";

const WILDCARD_CARDS: { id: WildcardPolicy; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: "skip",  label: "Skip",  desc: "Ignore wildcard subdomains — safest option",           icon: <ShieldCheck className="h-5 w-5" /> },
  { id: "force", label: "Force", desc: "Process them anyway — may include false positives",     icon: <ShieldAlert  className="h-5 w-5" /> },
  { id: "ask",   label: "Ask",   desc: "Pause the scan and let you decide",                     icon: <HelpCircle   className="h-5 w-5" /> },
];

export function EditTargetModal({ target, open, onClose, onUpdated }: Props) {
  const [wildcardPolicy,   setWildcardPolicy]   = useState<WildcardPolicy>(target.wildcard_policy);
  const [priority,         setPriority]         = useState(target.scan_priority);
  const [scanMode,         setScanMode]         = useState<ScanMode>(
    target.loop ? "loop" : target.manual_only ? "manual" : "schedule"
  );
  const [scheduleSubMode,  setScheduleSubMode]  = useState<ScheduleSubMode>(target.schedule_mode ?? "hourly");
  const [rescanInterval,   setRescanInterval]   = useState(target.rescan_interval);
  const [scheduleDays,     setScheduleDays]     = useState(target.schedule_days ?? 1);
  const [scheduleWeekday,  setScheduleWeekday]  = useState(target.schedule_weekday ?? 0);
  const [scheduleHour,     setScheduleHour]     = useState(target.schedule_hour ?? 0);
  const [scheduleMinute,   setScheduleMinute]   = useState(target.schedule_minute ?? 0);
  const [retentionRuns,    setRetentionRuns]    = useState(target.retention_runs);
  const [tags,             setTags]             = useState<string[]>(target.tags ?? []);

  const { actionFetch, pending: saving } = useActionFetch();

  // Sync form when target prop changes
  useEffect(() => {
    setWildcardPolicy(target.wildcard_policy);
    setPriority(target.scan_priority);
    setScanMode(target.loop ? "loop" : target.manual_only ? "manual" : "schedule");
    setScheduleSubMode(target.schedule_mode ?? "hourly");
    setRescanInterval(target.rescan_interval);
    setScheduleDays(target.schedule_days ?? 1);
    setScheduleWeekday(target.schedule_weekday ?? 0);
    setScheduleHour(target.schedule_hour ?? 0);
    setScheduleMinute(target.schedule_minute ?? 0);
    setRetentionRuns(target.retention_runs);
    setTags(target.tags ?? []);
  }, [target]);

  const handleSave = async () => {
    const res = await actionFetch(`/api/v1/targets/${target.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wildcard_policy:  wildcardPolicy,
        scan_priority:    priority,
        loop:             scanMode === "loop",
        manual_only:      scanMode === "manual",
        rescan_interval:  rescanInterval,
        retention_runs:   retentionRuns,
        tags,
        schedule_mode:    scheduleSubMode,
        schedule_days:    scheduleDays,
        schedule_weekday: scheduleWeekday,
        schedule_hour:    scheduleHour,
        schedule_minute:  scheduleMinute,
      }),
      successMessage: "Target updated",
      errorPrefix: "Save target",
    });
    if (!res) return;
    const updated = (await res.json()) as Target;
    onUpdated(updated);
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

          {/* Header */}
          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <Pencil className="h-4 w-4 text-primary" />
            </div>
            <div>
              <Dialog.Title className="text-sm font-semibold text-foreground">
                Edit Target
              </Dialog.Title>
              <Dialog.Description className="text-xs text-muted-foreground">
                {target.domain}
              </Dialog.Description>
            </div>
          </div>

          <div className="space-y-5">

            {/* Wildcard Policy */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                Wildcard Policy
              </label>
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
              <p className="mt-1 text-[10px] text-muted-foreground">
                Higher priority targets are scanned first when multiple are queued
              </p>
            </div>

            {/* Tags */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                Tags <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <TagInput tags={tags} onChange={setTags} />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Press Enter or comma to add. Lowercase letters, digits, hyphens only.
              </p>
            </div>

            {/* Scan Mode */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                Scan Mode
              </label>
              <ScanModeSelector
                mode={scanMode}
                scheduleSubMode={scheduleSubMode}
                rescanInterval={rescanInterval}
                scheduleDays={scheduleDays}
                scheduleWeekday={scheduleWeekday}
                scheduleHour={scheduleHour}
                scheduleMinute={scheduleMinute}
                retentionRuns={retentionRuns}
                onChange={(updates) => {
                  if (updates.mode !== undefined) setScanMode(updates.mode);
                  if (updates.scheduleSubMode !== undefined) setScheduleSubMode(updates.scheduleSubMode);
                  if (updates.rescanInterval !== undefined) setRescanInterval(updates.rescanInterval);
                  if (updates.scheduleDays !== undefined) setScheduleDays(updates.scheduleDays);
                  if (updates.scheduleWeekday !== undefined) setScheduleWeekday(updates.scheduleWeekday);
                  if (updates.scheduleHour !== undefined) setScheduleHour(updates.scheduleHour);
                  if (updates.scheduleMinute !== undefined) setScheduleMinute(updates.scheduleMinute);
                  if (updates.retentionRuns !== undefined) setRetentionRuns(updates.retentionRuns);
                }}
              />
            </div>

          </div>

          {/* Footer */}
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
              disabled={saving}
              className="flex items-center gap-2 rounded bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {saving ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
              ) : (
                <>Save changes</>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
