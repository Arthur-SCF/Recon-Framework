import * as Popover from "@radix-ui/react-popover";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  Server,
  Network,
  RefreshCw,
  ServerOff,
  Crosshair,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useNotifications, NOTIF_TYPES_WITH_TARGET } from "@/contexts/NotificationsContext";

interface TypeMeta {
  icon: LucideIcon;
  chip: string;
  label: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  new_hosts:          { icon: Server,        chip: "bg-sev-info/15 text-sev-info",         label: "Hosts" },
  new_subdomains:     { icon: Network,       chip: "bg-sev-info/15 text-sev-info",         label: "Subdomains" },
  host_changed:       { icon: RefreshCw,     chip: "bg-sev-medium/15 text-sev-medium",     label: "Changed" },
  host_gone:          { icon: ServerOff,     chip: "bg-sev-critical/15 text-sev-critical", label: "Gone" },
  takeover_candidate: { icon: Crosshair,     chip: "bg-sev-critical/15 text-sev-critical", label: "Takeover" },
  scan_complete:      { icon: CheckCircle2,  chip: "bg-sev-low/15 text-sev-low",           label: "Complete" },
  scan_error:         { icon: AlertTriangle, chip: "bg-sev-critical/15 text-sev-critical", label: "Error" },
  system:             { icon: Terminal,      chip: "bg-muted text-muted-foreground",       label: "System" },
};

const DEFAULT_META: TypeMeta = { icon: Bell, chip: "bg-muted text-muted-foreground", label: "System" };

const FILTER_TYPES = [
  "new_hosts",
  "host_changed",
  "host_gone",
  "takeover_candidate",
  "scan_complete",
  "scan_error",
] as const;

function metaFor(type: string): TypeMeta {
  return TYPE_META[type] ?? DEFAULT_META;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function navPath(type: string, targetId: string | null): string | null {
  if (!targetId) return null;
  const tab = NOTIF_TYPES_WITH_TARGET[type];
  return tab ? `/target/${targetId}?tab=${tab}` : `/target/${targetId}`;
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    error,
    markAllRead,
    markOneRead,
    deleteNotification,
    desktopPermission,
    requestDesktopPermission,
    retry,
  } = useNotifications();
  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const filtered = activeType
    ? notifications.filter((n) => n.type === activeType)
    : notifications;
  const navigate = useNavigate();

  async function handleNotifClick(id: string, type: string, targetId: string | null, isRead: boolean) {
    if (!isRead) await markOneRead(id);
    const path = navPath(type, targetId);
    if (path) {
      setOpen(false);
      navigate(path);
    }
  }

  return (
    <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary font-mono text-[10px] font-semibold tabular-nums text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[calc(100vw-1.5rem)] sm:w-88 max-w-[22rem] overflow-hidden rounded-lg border border-border bg-popover shadow-xl outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-faint-foreground">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-primary">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2.5">
              {/* Desktop push permission button */}
              {desktopPermission === "default" && (
                <button
                  onClick={() => void requestDesktopPermission()}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                  title="Enable desktop notifications"
                >
                  <Bell className="h-3 w-3" />
                  Enable push
                </button>
              )}
              {desktopPermission === "denied" && (
                <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-faint-foreground" title="Desktop notifications blocked by browser">
                  <BellOff className="h-3 w-3" />
                  Push blocked
                </span>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Type filter */}
          <div className="flex gap-1 border-b border-border px-3 py-2 overflow-x-auto scrollbar-thin">
            <button
              onClick={() => setActiveType(null)}
              className={cn(
                "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide whitespace-nowrap transition-colors",
                !activeType
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              All
            </button>
            {FILTER_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setActiveType(activeType === t ? null : t)}
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide whitespace-nowrap transition-colors",
                  activeType === t
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {metaFor(t).label}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-sev-critical/30 bg-sev-critical/10 text-sev-critical">
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-sev-critical">
                  Load failed
                </p>
                <p className="max-w-56 text-[11px] text-faint-foreground">{error}</p>
                <button
                  onClick={retry}
                  className="mt-1 rounded-md border border-border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="relative flex flex-col items-center justify-center gap-2 overflow-hidden py-12 text-center">
                <div className="deck-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
                <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-sev-low">
                  <Check className="h-4 w-4" />
                </span>
                <p className="relative font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {activeType ? "No matches" : "All clear"}
                </p>
                <p className="relative text-[11px] text-faint-foreground">
                  {activeType ? "No notifications of this type." : "New scan events will surface here."}
                </p>
              </div>
            ) : (
              filtered.slice(0, 30).map((n) => {
                const meta = metaFor(n.type);
                const Icon = meta.icon;
                const isNavigable = !!navPath(n.type, n.target_id);
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "group relative flex items-start gap-2.5 border-b border-border/50 px-3 py-2.5 last:border-0 transition-colors",
                      !n.is_read && "bg-primary/[0.045]",
                      isNavigable && "cursor-pointer hover:bg-surface-hover",
                    )}
                    onClick={isNavigable
                      ? () => void handleNotifClick(n.id, n.type, n.target_id, n.is_read)
                      : undefined
                    }
                  >
                    {/* Unread accent rule */}
                    {!n.is_read && (
                      <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden="true" />
                    )}

                    {/* Type icon chip */}
                    <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md", meta.chip)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs text-foreground", !n.is_read && "font-medium")}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide tabular-nums text-faint-foreground">
                        {meta.label} · {relativeTime(n.created_at)}
                      </p>
                    </div>

                    {/* Unread dot (swaps to actions on hover) */}
                    <div className="relative flex w-9 shrink-0 justify-end">
                      {!n.is_read && (
                        <span
                          className="led mt-1 h-1.5 w-1.5 rounded-full text-primary transition-opacity group-hover:opacity-0"
                          style={{ backgroundColor: "currentColor" }}
                          aria-hidden="true"
                        />
                      )}
                      <div
                        className="absolute right-0 top-0 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!n.is_read && (
                          <button
                            onClick={() => void markOneRead(n.id)}
                            className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors"
                            title="Mark read"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => setPendingDelete(n.id)}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>

    <DeleteConfirmDialog
      open={pendingDelete !== null}
      onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
      itemName="this notification"
      itemType="notification"
      onConfirm={async () => {
        if (pendingDelete) await deleteNotification(pendingDelete);
        setPendingDelete(null);
      }}
    />
    </>
  );
}
