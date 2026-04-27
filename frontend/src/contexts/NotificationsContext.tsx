import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Notification } from "@/types/api";
import { useWsSubscribe } from "@/hooks/useWebSocket";

interface NotificationsCtx {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  desktopPermission: NotificationPermission | "unsupported";
  fetchNotifications: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markOneRead: (id: string) => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  addLive: (notif: Notification) => void;
  requestDesktopPermission: () => Promise<void>;
  retry: () => void;
}

function coerceNotifications(payload: unknown): Notification[] {
  if (Array.isArray(payload)) return payload as Notification[];
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Notification[];
  }
  return [];
}

const Ctx = createContext<NotificationsCtx | null>(null);

const NOTIF_TYPES_WITH_TARGET: Record<string, string> = {
  new_hosts:          "hosts",
  new_subdomains:     "subdomains",
  takeover_candidate: "takeovers",
  host_changed:       "hosts",
  host_gone:          "hosts",
};

function fireDesktopNotif(notif: Notification) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;

  const n = new window.Notification(notif.title, {
    body: notif.message ?? undefined,
    icon: "/favicon.ico",
    tag: notif.id,
    silent: false,
  });

  // Auto-close after 6s
  setTimeout(() => n.close(), 6_000);

  // Clicking the desktop notification focuses the window; deep navigation
  // happens via the in-app bell (we can't reliably navigate from a worker context).
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopPermission, setDesktopPermission] =
    useState<NotificationPermission | "unsupported">(() => {
      if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
      return window.Notification.permission;
    });
  const fetchedRef = useRef(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const res = await fetch("/api/v1/notifications?limit=50");
      if (res.ok) {
        const payload = (await res.json()) as unknown;
        const list = coerceNotifications(payload);
        setNotifications(list);
        setUnreadCount(list.filter((n) => !n.is_read).length);
      } else {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch {
      setError("Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      void fetchNotifications();
    }
  }, [fetchNotifications]);

  // Re-fetch when any event that generates a notification fires
  useWsSubscribe(
    ["new_hosts", "new_subdomains", "takeover_candidate",
     "host_changed", "host_gone", "scan_completed", "scan_error"],
    () => void fetchNotifications(),
  );

  const requestDesktopPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await window.Notification.requestPermission();
    setDesktopPermission(result);
  }, []);

  const markAllRead = useCallback(async () => {
    const prevNotifs = notifications;
    const prevCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/v1/notifications/mark-all-read", { method: "POST" });
    } catch {
      setNotifications(prevNotifs);
      setUnreadCount(prevCount);
    }
  }, [notifications, unreadCount]);

  const markOneRead = useCallback(async (id: string) => {
    const prevNotifs = notifications;
    const prevCount = unreadCount;
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: "PUT" });
    } catch {
      setNotifications(prevNotifs);
      setUnreadCount(prevCount);
    }
  }, [notifications, unreadCount]);

  const deleteNotification = useCallback(async (id: string) => {
    const prevNotifs = notifications;
    const prevCount = unreadCount;
    const removed = notifications.find((n) => n.id === id);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    if (removed && !removed.is_read) {
      setUnreadCount((c) => Math.max(0, c - 1));
    }
    try {
      await fetch(`/api/v1/notifications/${id}`, { method: "DELETE" });
    } catch {
      setNotifications(prevNotifs);
      setUnreadCount(prevCount);
    }
  }, [notifications, unreadCount]);

  const retry = useCallback(() => { setError(null); void fetchNotifications(); }, [fetchNotifications]);

  const addLive = useCallback((notif: Notification) => {
    setNotifications((prev) => [notif, ...prev]);
    setUnreadCount((c) => c + 1);
    fireDesktopNotif(notif);
  }, []);

  return (
    <Ctx.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        error,
        desktopPermission,
        fetchNotifications,
        markAllRead,
        markOneRead,
        deleteNotification,
        addLive,
        requestDesktopPermission,
        retry,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications(): NotificationsCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useNotifications must be used inside NotificationsProvider");
  }
  return ctx;
}

export { NOTIF_TYPES_WITH_TARGET };
