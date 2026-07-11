import { motion } from "framer-motion";
import { Globe, Layers, Shield, Gauge, Repeat, Hand, Clock, Tag } from "lucide-react";
import type { ScanMode, ScheduleSubMode } from "@/components/ScanModeSelector";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

interface WizardStepReviewProps {
  domain: string;
  template: string;
  wildcardPolicy: string;
  priority: number;
  scanMode: ScanMode;
  scheduleSubMode: ScheduleSubMode;
  tags: string[];
  rescanInterval: number;
  scheduleDays: number;
  scheduleWeekday: number;
  scheduleHour: number;
  scheduleMinute: number;
  retentionRuns: number;
}

const TEMPLATE_LABELS: Record<string, string> = {
  standard: "Standard",
  saas: "SaaS / Cloud",
  corporate: "Corporate",
  minimal: "Minimal",
};

const WILDCARD_LABELS: Record<string, string> = {
  skip:  "Skip wildcards (safest)",
  force: "Force — process wildcards",
  ask:   "Ask — pause on wildcard",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatScheduleLabel(
  subMode: ScheduleSubMode,
  rescanInterval: number,
  scheduleDays: number,
  scheduleWeekday: number,
  scheduleHour: number,
  scheduleMinute: number,
): string {
  const time = `${pad2(scheduleHour)}:${pad2(scheduleMinute)}`;
  if (subMode === "hourly") {
    if (rescanInterval < 24) return `Every ${rescanInterval}h`;
    const d = rescanInterval / 24;
    return Number.isInteger(d) ? `Every ${d} day${d !== 1 ? "s" : ""}` : `Every ${rescanInterval}h`;
  }
  if (subMode === "daily") {
    return `Every ${scheduleDays} ${scheduleDays === 1 ? "day" : "days"} at ${time}`;
  }
  return `Every ${WEEKDAYS[scheduleWeekday]} at ${time}`;
}

export function WizardStepReview({
  domain,
  template,
  wildcardPolicy,
  priority,
  scanMode,
  scheduleSubMode,
  tags,
  rescanInterval,
  scheduleDays,
  scheduleWeekday,
  scheduleHour,
  scheduleMinute,
  retentionRuns,
}: WizardStepReviewProps) {
  const scheduleLabel = scanMode === "loop"
    ? "N/A — loop mode"
    : scanMode === "manual"
      ? "N/A — manual only"
      : formatScheduleLabel(scheduleSubMode, rescanInterval, scheduleDays, scheduleWeekday, scheduleHour, scheduleMinute);

  const scanModeLabel = scanMode === "loop"
    ? "Loop — restarts immediately on completion"
    : scanMode === "manual"
      ? "Manual only — never auto-schedules"
      : "Scheduled";

  return (
    <motion.div
      className="space-y-5 py-2"
      initial={{ opacity: 0, x: 200 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -200 }}
      transition={{ duration: 0.2 }}
    >
      <div className="text-center">
        <h3 className="text-base font-semibold text-foreground">
          Review & Create
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Verify your configuration before creating the target
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 space-y-4">

        {/* Domain */}
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 shrink-0">
            <Globe className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Domain</p>
            <p className="text-sm font-mono font-semibold text-foreground">{domain}</p>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Template */}
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Template</p>
            <p className="text-sm font-medium text-foreground">
              {TEMPLATE_LABELS[template] ?? template}
            </p>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Wildcard + Priority */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Wildcard</p>
              <p className="text-xs font-medium text-foreground">
                {WILDCARD_LABELS[wildcardPolicy] ?? wildcardPolicy}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <Gauge className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Priority</p>
              <p className="font-mono text-xs tabular-nums text-foreground">{priority} / 10</p>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Scan Mode + Schedule */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              {scanMode === "loop" ? (
                <Repeat className="h-4 w-4 text-primary" />
              ) : scanMode === "manual" ? (
                <Hand className="h-4 w-4 text-primary" />
              ) : (
                <Clock className="h-4 w-4 text-primary" />
              )}
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Scan Mode</p>
              <p className="text-xs font-medium text-foreground">{scanModeLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-md bg-primary/10 p-2 shrink-0">
              <Clock className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Schedule</p>
              <p className={`text-xs font-medium ${scanMode !== "schedule" ? "text-muted-foreground italic" : "text-foreground"}`}>
                {scheduleLabel}
              </p>
            </div>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Retention */}
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 shrink-0">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Retention</p>
            <p className="font-mono text-xs tabular-nums text-foreground">{retentionRuns} scans</p>
          </div>
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 p-2 shrink-0">
                <Tag className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
