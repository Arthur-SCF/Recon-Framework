import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Target, Globe, Activity, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationsContext";
import type { Target as TargetType } from "@/types/api";

interface SchedulerState {
  active: { target_id: string; domain: string; session_id: string; status: string; started_at: string } | null;
  queue: { target_id: string; domain: string }[];
}

type Tone = "accent" | "low" | "info" | "medium";

const TONE: Record<Tone, { text: string; rule: string }> = {
  accent: { text: "text-primary", rule: "bg-primary" },
  low: { text: "text-sev-low", rule: "bg-sev-low" },
  info: { text: "text-sev-info", rule: "bg-sev-info" },
  medium: { text: "text-sev-medium", rule: "bg-sev-medium" },
};

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  tone: Tone;
  index: number;
}

function StatCard({ label, value, icon, tone, index }: StatCardProps) {
  const t = TONE[tone];
  return (
    <motion.div
      className="relative overflow-hidden rounded-lg border border-border bg-card p-4"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-foreground">
          {label}
        </p>
        <span className={cn("shrink-0", t.text)}>{icon}</span>
      </div>
      <p className="mt-2 truncate font-mono text-[22px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      <span className={cn("absolute inset-x-0 bottom-0 h-0.5 opacity-70", t.rule)} />
    </motion.div>
  );
}

interface StatsRowProps {
  targets: TargetType[];
}

export function StatsRow({ targets }: StatsRowProps) {
  const { unreadCount } = useNotifications();
  const [scheduler, setScheduler] = useState<SchedulerState | null>(null);

  useEffect(() => {
    void fetch("/api/v1/scheduler/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setScheduler(d as SchedulerState))
      .catch(() => null);
  }, []);

  const activeScans = scheduler?.active ? 1 : 0;
  const queuedCount = scheduler?.queue?.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        label="Targets"
        value={targets.length}
        icon={<Target className="h-4 w-4" />}
        tone="accent"
        index={0}
      />
      <StatCard
        label="Running Scans"
        value={activeScans > 0 ? `${activeScans} + ${queuedCount} queued` : "None"}
        icon={<Activity className="h-4 w-4" />}
        tone="low"
        index={1}
      />
      <StatCard
        label="Completed"
        value={targets.filter((t) => t.status === "completed").length}
        icon={<Globe className="h-4 w-4" />}
        tone="info"
        index={2}
      />
      <StatCard
        label="Notifications"
        value={unreadCount}
        icon={<Bell className="h-4 w-4" />}
        tone="medium"
        index={3}
      />
    </div>
  );
}
