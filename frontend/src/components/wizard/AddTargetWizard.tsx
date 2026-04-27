import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence } from "framer-motion";
import { Loader2, ArrowRight, ArrowLeft, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActionFetch } from "@/hooks/useActionFetch";
import type { Target, TargetCreate } from "@/types/api";
import { WizardProgress } from "./WizardProgress";
import { WizardStepDomain } from "./WizardStepDomain";
import { WizardStepTemplate } from "./WizardStepTemplate";
import { WizardStepOptions } from "./WizardStepOptions";
import { WizardStepReview } from "./WizardStepReview";
import type { ScanMode, ScheduleSubMode } from "@/components/ScanModeSelector";

type WildcardPolicy = NonNullable<TargetCreate["wildcard_policy"]>;

const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (target: Target) => void;
}

export function AddTargetWizard({ open, onOpenChange, onCreated }: Props) {
  const [step, setStep] = useState(1);
  const [domain, setDomain] = useState("");
  const [template, setTemplate] = useState<string>("standard");
  const [wildcardPolicy,  setWildcardPolicy]  = useState<WildcardPolicy>("skip");
  const [priority,        setPriority]        = useState(5);
  const [scanMode,        setScanMode]        = useState<ScanMode>("schedule");
  const [scheduleSubMode, setScheduleSubMode] = useState<ScheduleSubMode>("hourly");
  const [tags,            setTags]            = useState<string[]>([]);
  const [rescanInterval,  setRescanInterval]  = useState(24);
  const [scheduleDays,    setScheduleDays]    = useState(1);
  const [scheduleWeekday, setScheduleWeekday] = useState(0);
  const [scheduleHour,    setScheduleHour]    = useState(0);
  const [scheduleMinute,  setScheduleMinute]  = useState(0);
  const [retentionRuns,   setRetentionRuns]   = useState(5);
  const { actionFetch, pending: loading } = useActionFetch();

  function reset() {
    setStep(1);
    setDomain("");
    setTemplate("standard");
    setWildcardPolicy("skip");
    setPriority(5);
    setScanMode("schedule");
    setScheduleSubMode("hourly");
    setTags([]);
    setRescanInterval(24);
    setScheduleDays(1);
    setScheduleWeekday(0);
    setScheduleHour(0);
    setScheduleMinute(0);
    setRetentionRuns(5);
  }

  const canNext =
    step === 1
      ? domain.trim().length > 0 && DOMAIN_REGEX.test(domain.trim())
      : true;

  async function handleSubmit() {
    const res = await actionFetch("/api/v1/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: domain.trim(),
        pipeline_template: template,
        wildcard_policy: wildcardPolicy,
        scan_priority: priority,
        loop: scanMode === "loop",
        manual_only: scanMode === "manual",
        tags,
        rescan_interval: rescanInterval,
        retention_runs: retentionRuns,
        schedule_mode: scheduleSubMode,
        schedule_days: scheduleDays,
        schedule_weekday: scheduleWeekday,
        schedule_hour: scheduleHour,
        schedule_minute: scheduleMinute,
      } satisfies TargetCreate),
      successMessage: "Target added",
      errorPrefix: "Create target",
    });

    if (res) {
      const result = (await res.json()) as Target;
      onCreated(result);
      onOpenChange(false);
      reset();
    }
  }

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen);
    if (!isOpen) reset();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl outline-none">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Dialog.Title className="text-base font-semibold text-foreground">
              Add Target
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          {/* Progress */}
          <div className="border-b border-border px-6 py-4">
            <WizardProgress currentStep={step} />
          </div>

          {/* Step content */}
          <div className="px-6 py-4 min-h-[320px]">
            <AnimatePresence mode="wait">
              {step === 1 && (
                <WizardStepDomain
                  key="domain"
                  domain={domain}
                  onChange={setDomain}
                />
              )}
              {step === 2 && (
                <WizardStepTemplate
                  key="template"
                  template={template}
                  onChange={setTemplate}
                />
              )}
              {step === 3 && (
                <WizardStepOptions
                  key="options"
                  wildcardPolicy={wildcardPolicy}
                  priority={priority}
                  scanMode={scanMode}
                  scheduleSubMode={scheduleSubMode}
                  tags={tags}
                  rescanInterval={rescanInterval}
                  scheduleDays={scheduleDays}
                  scheduleWeekday={scheduleWeekday}
                  scheduleHour={scheduleHour}
                  scheduleMinute={scheduleMinute}
                  retentionRuns={retentionRuns}
                  onChange={(updates) => {
                    if (updates.wildcardPolicy !== undefined) setWildcardPolicy(updates.wildcardPolicy);
                    if (updates.priority !== undefined) setPriority(updates.priority);
                    if (updates.scanMode !== undefined) setScanMode(updates.scanMode);
                    if (updates.scheduleSubMode !== undefined) setScheduleSubMode(updates.scheduleSubMode);
                    if (updates.tags !== undefined) setTags(updates.tags);
                    if (updates.rescanInterval !== undefined) setRescanInterval(updates.rescanInterval);
                    if (updates.scheduleDays !== undefined) setScheduleDays(updates.scheduleDays);
                    if (updates.scheduleWeekday !== undefined) setScheduleWeekday(updates.scheduleWeekday);
                    if (updates.scheduleHour !== undefined) setScheduleHour(updates.scheduleHour);
                    if (updates.scheduleMinute !== undefined) setScheduleMinute(updates.scheduleMinute);
                    if (updates.retentionRuns !== undefined) setRetentionRuns(updates.retentionRuns);
                  }}
                />
              )}
              {step === 4 && (
                <WizardStepReview
                  key="review"
                  domain={domain.trim()}
                  template={template}
                  wildcardPolicy={wildcardPolicy}
                  priority={priority}
                  scanMode={scanMode}
                  scheduleSubMode={scheduleSubMode}
                  tags={tags}
                  rescanInterval={rescanInterval}
                  scheduleDays={scheduleDays}
                  scheduleWeekday={scheduleWeekday}
                  scheduleHour={scheduleHour}
                  scheduleMinute={scheduleMinute}
                  retentionRuns={retentionRuns}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Footer navigation */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={() => step > 1 && setStep(step - 1)}
              disabled={step === 1}
              className={cn(
                "flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors",
                step === 1
                  ? "opacity-40 cursor-not-allowed"
                  : "hover:text-foreground hover:bg-accent/30",
              )}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={() => canNext && setStep(step + 1)}
                disabled={!canNext}
                className={cn(
                  "flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors",
                  canNext
                    ? "hover:bg-primary/90"
                    : "opacity-50 cursor-not-allowed",
                )}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={loading}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create Target
              </button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
