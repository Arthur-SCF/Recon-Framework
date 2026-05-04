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
import { Menu, Wifi, WifiOff } from "lucide-react";
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
            className="flex items-center gap-1.5 px-2 text-xs disabled:cursor-default"
          >
            {connectionState === "connected" && health === "ok" && (
              <>
                <Wifi className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline text-primary">Live</span>
              </>
            )}
            {connectionState === "connected" && health === "degraded" && (
              <>
                <WifiOff className="h-3.5 w-3.5 text-amber-500" />
                <span className="hidden sm:inline text-amber-500">Connection issues</span>
              </>
            )}
            {connectionState === "reconnecting" && (
              <>
                <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="hidden sm:inline text-muted-foreground">Reconnecting…</span>
              </>
            )}
            {connectionState === "disconnected" && (
              <>
                <WifiOff className="h-3.5 w-3.5 text-destructive" />
                <span className="hidden sm:inline text-destructive">Disconnected</span>
              </>
            )}
          </button>

          <ThemeSelector />
          <NotificationBell />
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
