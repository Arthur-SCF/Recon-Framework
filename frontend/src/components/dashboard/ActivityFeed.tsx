import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationsContext";
import { InlineError } from "@/components/ui/InlineError";

const TYPE_COLOR: Record<string, string> = {
  new_hosts: "bg-primary",
  new_subdomains: "bg-primary",
  host_changed: "bg-yellow-500",
  host_gone: "bg-destructive",
  takeover_candidate: "bg-destructive",
  scan_complete: "bg-green-500",
  scan_error: "bg-destructive",
  system: "bg-muted-foreground",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export function ActivityFeed() {
  const { notifications, error, retry } = useNotifications();
  const navigate = useNavigate();
  const recent = notifications.slice(0, 10);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium text-foreground mb-3">Recent Activity</p>

      {error && <InlineError message={error} onRetry={retry} compact />}

      {recent.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">
          No activity yet
        </p>
      ) : (
        <div className="space-y-2">
          {recent.map((n) => (
            <button
              key={n.id}
              onClick={() => n.target_id && navigate(`/target/${n.target_id}`)}
              className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent/30 transition-colors"
            >
              <span
                className={cn(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  TYPE_COLOR[n.type] ?? "bg-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-foreground truncate">{n.title}</p>
                {n.message && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {n.message}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {relativeTime(n.created_at)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
