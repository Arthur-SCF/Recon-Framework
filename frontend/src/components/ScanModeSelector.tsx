import { AnimatePresence, motion } from "framer-motion";
import { Repeat, Clock, Hand, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberInput } from "@/components/config/params/NumberInput";

export type ScanMode = "loop" | "schedule" | "manual";
export type ScheduleSubMode = "hourly" | "daily" | "weekly";

const MODES: { id: ScanMode; label: string; sub: string; icon: React.ElementType }[] = [
  { id: "loop",     label: "Loop",     sub: "Continuous",  icon: Repeat },
  { id: "schedule", label: "Schedule", sub: "Time-based",  icon: Clock  },
  { id: "manual",   label: "Manual",   sub: "On-demand",   icon: Hand   },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SUB_MODES: { id: ScheduleSubMode; label: string }[] = [
  { id: "hourly", label: "Every N hours" },
  { id: "daily",  label: "Every N days"  },
  { id: "weekly", label: "Weekly"         },
];

interface Props {
  mode: ScanMode;
  scheduleSubMode: ScheduleSubMode;
  rescanInterval: number;
  scheduleDays: number;
  scheduleWeekday: number;
  scheduleHour: number;
  scheduleMinute: number;
  retentionRuns: number;
  onChange: (updates: {
    mode?: ScanMode;
    scheduleSubMode?: ScheduleSubMode;
    rescanInterval?: number;
    scheduleDays?: number;
    scheduleWeekday?: number;
    scheduleHour?: number;
    scheduleMinute?: number;
    retentionRuns?: number;
  }) => void;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatHourly(hours: number): string {
  if (hours < 24) return `every ${hours}h`;
  const days = hours / 24;
  return Number.isInteger(days)
    ? `every ${days} day${days !== 1 ? "s" : ""}`
    : `every ${hours}h`;
}

function TimeInput({
  hour,
  minute,
  onChange,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
}) {
  const value = `${pad2(hour)}:${pad2(minute)}`;
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => {
        const [h, m] = e.target.value.split(":").map(Number);
        if (!isNaN(h) && !isNaN(m)) onChange(h, m);
      }}
      className="w-28 sm:w-24 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

export function ScanModeSelector({
  mode,
  scheduleSubMode,
  rescanInterval,
  scheduleDays,
  scheduleWeekday,
  scheduleHour,
  scheduleMinute,
  retentionRuns,
  onChange,
}: Props) {
  return (
    <div className="space-y-3">

      {/* Top-level mode segmented control */}
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-muted/20 p-1">
        {MODES.map(({ id, label, sub, icon: Icon }) => {
          const selected = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange({ mode: id })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg py-2.5 px-2 text-center transition-all",
                selected
                  ? "bg-card border border-border shadow-sm"
                  : "hover:bg-muted/40",
              )}
            >
              <Icon className={cn("h-4 w-4 transition-colors", selected ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-xs font-semibold leading-tight", selected ? "text-foreground" : "text-muted-foreground")}>
                {label}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">{sub}</span>
            </button>
          );
        })}
      </div>

      {/* Mode detail panel */}
      <AnimatePresence mode="wait">
        {mode === "loop" && (
          <motion.div
            key="loop"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Repeat className="h-3.5 w-3.5 text-primary shrink-0" />
              <p className="text-xs font-medium text-primary">Loop mode</p>
            </div>
            {[
              "Restarts automatically as soon as each scan completes",
              "Yields to any manually triggered or scheduled target",
              "Stops on cancel or error — restart manually to re-enable",
              "Multiple loop targets rotate fairly (oldest scan goes next)",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/50" />
                <p className="text-[11px] text-muted-foreground leading-snug">{line}</p>
              </div>
            ))}
          </motion.div>
        )}

        {mode === "schedule" && (
          <motion.div
            key="schedule"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg border border-border bg-card p-3 space-y-3"
          >
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs font-medium text-foreground">Schedule settings</p>
            </div>

            {/* Sub-mode tabs */}
            <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5">
              {SUB_MODES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange({ scheduleSubMode: id })}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all",
                    scheduleSubMode === id
                      ? "bg-card border border-border shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Sub-mode settings */}
            <AnimatePresence mode="wait">
              {scheduleSubMode === "hourly" && (
                <motion.div
                  key="hourly"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-1.5"
                >
                  <label className="block text-[11px] text-muted-foreground">
                    Rescan interval
                  </label>
                  <div className="flex items-center gap-2">
                    <NumberInput
                      value={rescanInterval}
                      min={1}
                      max={8760}
                      onChange={(v) => onChange({ rescanInterval: v })}
                      className="w-20 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <span className="text-xs text-muted-foreground">hours</span>
                    <span className="text-[11px] text-muted-foreground/60">
                      — {formatHourly(rescanInterval)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" />
                    Starts when this interval has elapsed since the last completed scan. Skipped if already running.
                  </p>
                </motion.div>
              )}

              {scheduleSubMode === "daily" && (
                <motion.div
                  key="daily"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-2"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground shrink-0">Every</label>
                      <NumberInput
                        value={scheduleDays}
                        min={1}
                        max={365}
                        onChange={(v) => onChange({ scheduleDays: v })}
                        className="w-16 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {scheduleDays === 1 ? "day" : "days"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground shrink-0">at</label>
                      <TimeInput
                        hour={scheduleHour}
                        minute={scheduleMinute}
                        onChange={(h, m) => onChange({ scheduleHour: h, scheduleMinute: m })}
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" />
                    Runs at {pad2(scheduleHour)}:{pad2(scheduleMinute)} every {scheduleDays} {scheduleDays === 1 ? "day" : "days"} since the last scan.
                  </p>
                </motion.div>
              )}

              {scheduleSubMode === "weekly" && (
                <motion.div
                  key="weekly"
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.12 }}
                  className="space-y-2"
                >
                  <div className="space-y-1.5">
                    <label className="block text-[11px] text-muted-foreground">Day of week</label>
                    <div className="flex gap-1">
                      {WEEKDAYS.map((day, idx) => (
                        <button
                          key={day}
                          type="button"
                          onClick={() => onChange({ scheduleWeekday: idx })}
                          className={cn(
                            "flex-1 rounded px-1 py-1.5 text-[10px] font-medium transition-all",
                            scheduleWeekday === idx
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/30 text-muted-foreground hover:bg-muted/60",
                          )}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-muted-foreground shrink-0">at</label>
                    <TimeInput
                      hour={scheduleHour}
                      minute={scheduleMinute}
                      onChange={(h, m) => onChange({ scheduleHour: h, scheduleMinute: m })}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground flex items-start gap-1">
                    <Info className="h-3 w-3 shrink-0 mt-0.5" />
                    Runs every {WEEKDAYS[scheduleWeekday]} at {pad2(scheduleHour)}:{pad2(scheduleMinute)}.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {mode === "manual" && (
          <motion.div
            key="manual"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg border border-border bg-card p-3 space-y-1.5"
          >
            <div className="flex items-center gap-1.5 mb-2">
              <Hand className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <p className="text-xs font-medium text-foreground">Manual mode</p>
            </div>
            {[
              "Only starts when you explicitly click Start Scan",
              "Never automatically triggered — not by schedule, not by loop",
              "Useful for targets you scan on your own timing",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                <p className="text-[11px] text-muted-foreground leading-snug">{line}</p>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Retention — applies to all modes */}
      <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/10 px-3 py-2.5">
        <div>
          <p className="text-xs font-medium text-foreground">Retention</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Older scan sessions are pruned automatically
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <NumberInput
            value={retentionRuns}
            min={1}
            max={100}
            onChange={(v) => onChange({ retentionRuns: v })}
            className="w-14 rounded border border-border bg-background px-2 py-1 text-xs text-foreground text-center focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-xs text-muted-foreground">scans</span>
        </div>
      </div>

    </div>
  );
}
