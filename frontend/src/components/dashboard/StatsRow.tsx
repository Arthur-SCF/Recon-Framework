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

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: string;
  index: number;
}

function StatCard({ label, value, icon, accent, index }: StatCardProps) {
  return (
    <motion.div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-card p-4",
        "border-l-[3px]",
        accent,
      )}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
        </div>
        <div className="rounded-md bg-muted/30 p-2 text-muted-foreground">
          {icon}
        </div>
      </div>
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
        accent="border-l-primary"
        index={0}
      />
      <StatCard
        label="Running Scans"
        value={activeScans > 0 ? `${activeScans} + ${queuedCount} queued` : "None"}
        icon={<Activity className="h-4 w-4" />}
        accent="border-l-green-500"
        index={1}
      />
      <StatCard
        label="Completed"
        value={targets.filter((t) => t.status === "completed").length}
        icon={<Globe className="h-4 w-4" />}
        accent="border-l-blue-500"
        index={2}
      />
      <StatCard
        label="Notifications"
        value={unreadCount}
        icon={<Bell className="h-4 w-4" />}
        accent="border-l-yellow-500"
        index={3}
      />
    </div>
  );
}
