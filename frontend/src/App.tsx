import { useCallback, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeSelector } from "@/components/ThemeSelector";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GlobalSearch, type GlobalSearchHandle } from "@/components/GlobalSearch";
import { KeyboardShortcutsModal } from "@/components/KeyboardShortcutsModal";
import { useWebSocket, type WsEvent } from "@/hooks/useWebSocket";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotifications } from "@/contexts/NotificationsContext";
import type { Notification } from "@/types/api";
import { Menu } from "lucide-react";
import { useApiHealth } from "@/hooks/useApiHealth";

export function App() {
  const { addLive } = useNotifications();
  const searchRef = useRef<GlobalSearchHandle>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleWsEvent = useCallback(
    (event: WsEvent) => {
      if (event.type === "notification") {
        const d = event.data as {
          id: string;
          type: string;
          title: string;
          message?: string;
          data?: Record<string, unknown>;
        };
        const notif: Notification = {
          id: d.id,
          target_id: event.target_id,
          session_id: event.session_id,
          type: d.type,
          title: d.title,
          message: d.message ?? null,
          data: d.data ?? null,
          is_read: false,
          created_at: event.timestamp,
        };
        addLive(notif);
      }
    },
    [addLive],
  );

  const { connectionState } = useWebSocket(handleWsEvent);
  const { health, forceRefreshAll } = useApiHealth();

  useKeyboardShortcuts({
    onFocusSearch: () => searchRef.current?.focus(),
    onShowHelp:    () => setShortcutsOpen(true),
  });

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-3">
          {/* Hamburger — mobile only */}
          <button
            className="lg:hidden rounded p-1.5 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumbs — hidden on mobile */}
          <div className="hidden sm:block flex-1 min-w-0 pl-2">
            <Breadcrumbs />
          </div>

          {/* Mobile spacer */}
          <div className="sm:hidden flex-1" />

          {/* Global Search */}
          <GlobalSearch ref={searchRef} />

          <div className="instrument-cluster flex shrink-0 items-center gap-0.5 rounded-lg p-0.5">
            {/* WebSocket + API health status */}
            <button
            disabled={health === "ok" && connectionState === "connected"}
            onClick={() => health === "degraded" && forceRefreshAll()}
            title={
              health === "degraded"
                ? "Some data may be stale — click to refresh"
                : connectionState === "connected"
                ? "WebSocket connected"
                : "WebSocket disconnected"
            }
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] disabled:cursor-default"
          >
            {connectionState === "connected" && health === "ok" && (
              <>
                <span
                  className="led h-1.5 w-1.5 shrink-0 animate-pulse rounded-full text-sev-low"
                  style={{ backgroundColor: "currentColor" }}
                />
                <span className="hidden text-muted-foreground sm:inline">Live</span>
              </>
            )}
            {connectionState === "connected" && health === "degraded" && (
              <>
                <span
                  className="led h-1.5 w-1.5 shrink-0 rounded-full text-sev-medium"
                  style={{ backgroundColor: "currentColor" }}
                />
                <span className="hidden text-sev-medium sm:inline">Degraded</span>
              </>
            )}
            {connectionState === "reconnecting" && (
              <>
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
                <span className="hidden text-muted-foreground sm:inline">Reconnecting</span>
              </>
            )}
            {connectionState === "disconnected" && (
              <>
                <span
                  className="led h-1.5 w-1.5 shrink-0 rounded-full text-sev-critical"
                  style={{ backgroundColor: "currentColor" }}
                />
                <span className="hidden text-sev-critical sm:inline">Offline</span>
              </>
            )}
            </button>

            <div className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden="true" />

            <ThemeSelector />
            <NotificationBell />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-background">
          <Outlet />
        </main>
      </div>

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
