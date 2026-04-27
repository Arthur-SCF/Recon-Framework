import { motion } from "framer-motion";
import { ShieldCheck, ShieldAlert, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagInput } from "@/components/TagInput";
import { ScanModeSelector, type ScanMode, type ScheduleSubMode } from "@/components/ScanModeSelector";
import type { TargetCreate } from "@/types/api";

type WildcardPolicy = NonNullable<TargetCreate["wildcard_policy"]>;

const WILDCARD_CARDS: {
  id: WildcardPolicy;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "skip",
    label: "Skip",
    desc: "Ignore wildcard subdomains — safest option",
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    id: "force",
    label: "Force",
    desc: "Process them anyway — may include false positives",
    icon: <ShieldAlert className="h-5 w-5" />,
  },
  {
    id: "ask",
    label: "Ask",
    desc: "Pause the scan and let you decide",
    icon: <HelpCircle className="h-5 w-5" />,
  },
];

interface WizardStepOptionsProps {
  wildcardPolicy: WildcardPolicy;
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
  onChange: (updates: {
    wildcardPolicy?: WildcardPolicy;
    priority?: number;
    scanMode?: ScanMode;
    scheduleSubMode?: ScheduleSubMode;
    tags?: string[];
    rescanInterval?: number;
    scheduleDays?: number;
    scheduleWeekday?: number;
    scheduleHour?: number;
    scheduleMinute?: number;
    retentionRuns?: number;
  }) => void;
}

export function WizardStepOptions({
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
  onChange,
}: WizardStepOptionsProps) {

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
          Configure options
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Fine-tune scan behavior
        </p>
      </div>

      {/* Wildcard Policy */}
      <div>
        <label className="mb-2 block text-xs font-medium text-foreground">
          Wildcard Policy
        </label>
        <div className="grid grid-cols-3 gap-2">
          {WILDCARD_CARDS.map((w) => {
            const selected = wildcardPolicy === w.id;
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => onChange({ wildcardPolicy: w.id })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center transition-all",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <span className={selected ? "text-primary" : "text-muted-foreground"}>
                  {w.icon}
                </span>
                <span className={cn("text-xs font-medium", selected ? "text-primary" : "text-foreground")}>
                  {w.label}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  {w.desc}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Priority slider */}
      <div>
        <label className="mb-2 flex items-center justify-between text-xs font-medium text-foreground">
          <span>Scan Priority</span>
          <span className="text-muted-foreground">{priority} / 10</span>
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={priority}
          onChange={(e) => onChange({ priority: Number(e.target.value) })}
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
        <TagInput
          tags={tags}
          onChange={(t) => onChange({ tags: t })}
          placeholder="hackerone, high-priority…"
        />
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
            if (updates.mode !== undefined) onChange({ scanMode: updates.mode });
            if (updates.scheduleSubMode !== undefined) onChange({ scheduleSubMode: updates.scheduleSubMode });
            if (updates.rescanInterval !== undefined) onChange({ rescanInterval: updates.rescanInterval });
            if (updates.scheduleDays !== undefined) onChange({ scheduleDays: updates.scheduleDays });
            if (updates.scheduleWeekday !== undefined) onChange({ scheduleWeekday: updates.scheduleWeekday });
            if (updates.scheduleHour !== undefined) onChange({ scheduleHour: updates.scheduleHour });
            if (updates.scheduleMinute !== undefined) onChange({ scheduleMinute: updates.scheduleMinute });
            if (updates.retentionRuns !== undefined) onChange({ retentionRuns: updates.retentionRuns });
          }}
        />
      </div>
    </motion.div>
  );
}
