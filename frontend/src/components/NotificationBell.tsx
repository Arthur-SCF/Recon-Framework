import * as Popover from "@radix-ui/react-popover";
import { Bell, BellOff, Check, CheckCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { useNotifications, NOTIF_TYPES_WITH_TARGET } from "@/contexts/NotificationsContext";

const TYPE_COLORS: Record<string, string> = {
  new_hosts:          "text-primary",
  new_subdomains:     "text-primary",
  host_changed:       "text-yellow-400",
  host_gone:          "text-red-400",
  takeover_candidate: "text-red-400",
  scan_complete:      "text-green-400",
  scan_error:         "text-destructive",
  system:             "text-muted-foreground",
};

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
            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-lg border border-border bg-popover shadow-xl outline-none"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
            <span className="text-sm font-semibold text-foreground">
              Notifications
            </span>
            <div className="flex items-center gap-2">
              {/* Desktop push permission button */}
              {desktopPermission === "default" && (
                <button
                  onClick={() => void requestDesktopPermission()}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  title="Enable desktop notifications"
                >
                  <Bell className="h-3 w-3" />
                  Enable push
                </button>
              )}
              {desktopPermission === "denied" && (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground/50" title="Desktop notifications blocked by browser">
                  <BellOff className="h-3 w-3" />
                  Push blocked
                </span>
              )}
              {unreadCount > 0 && (
                <button
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Type filter */}
          <div className="flex gap-1 px-3 py-1.5 border-b border-border overflow-x-auto">
            <button
              onClick={() => setActiveType(null)}
              className={`px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap ${!activeType ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
            >
              All
            </button>
            {["new_hosts", "host_changed", "host_gone", "scan_complete", "scan_error", "takeover_candidate"].map((t) => (
              <button
                key={t}
                onClick={() => setActiveType(activeType === t ? null : t)}
                className={`px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap ${activeType === t ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-destructive">{error}</p>
                <button onClick={retry} className="text-xs text-primary hover:underline mt-1">Retry</button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              filtered.slice(0, 30).map((n) => {
                const isNavigable = !!navPath(n.type, n.target_id);
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "group flex items-start gap-2.5 border-b border-border/50 px-3 py-2.5 last:border-0",
                      !n.is_read && "bg-accent/30",
                      isNavigable && "cursor-pointer hover:bg-accent/50 transition-colors",
                    )}
                    onClick={isNavigable
                      ? () => void handleNotifClick(n.id, n.type, n.target_id, n.is_read)
                      : undefined
                    }
                  >
                    <div
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        !n.is_read ? "bg-primary" : "bg-transparent",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-xs font-medium",
                          TYPE_COLORS[n.type] ?? "text-foreground",
                        )}
                      >
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {n.message}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground/60">
                        {relativeTime(n.created_at)}
                      </p>
                    </div>
                    <div
                      className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {!n.is_read && (
                        <button
                          onClick={() => void markOneRead(n.id)}
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          title="Mark read"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => setPendingDelete(n.id)}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
