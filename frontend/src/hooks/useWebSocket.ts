import { useEffect, useRef, useCallback, useState } from "react";

export interface WsEvent {
  type: string;
  target_id: string | null;
  session_id: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: WsEvent) => void;

const WS_URL =
  window.location.protocol === "https:"
    ? `wss://${window.location.host}/ws`
    : `ws://${window.location.host}/ws`;

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;
const BACKOFF_FACTOR = 2;

// ---------------------------------------------------------------------------
// Module-level pub/sub bus — shared across all useWebSocket callers so only
// one WebSocket connection exists regardless of how many hooks subscribe.
// ---------------------------------------------------------------------------

type Subscriber = { id: symbol; handler: EventHandler };
const subscribers: Subscriber[] = [];
let ws: WebSocket | null = null;
let delay = INITIAL_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const connectedListeners = new Set<(v: boolean) => void>();
let isConnected = false;

export type ConnectionState = "connected" | "reconnecting" | "disconnected";
let reconnectAttempts = 0;
let moduleConnectionState: ConnectionState = "reconnecting";
const connectionStateListeners = new Set<(s: ConnectionState) => void>();

function notifyConnectionState(s: ConnectionState) {
  moduleConnectionState = s;
  connectionStateListeners.forEach((fn) => fn(s));
}

function notifyConnected(v: boolean) {
  isConnected = v;
  connectedListeners.forEach((fn) => fn(v));
}

function dispatch(event: WsEvent) {
  subscribers.forEach(({ handler }) => handler(event));
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    delay = INITIAL_DELAY_MS;
    reconnectAttempts = 0;
    notifyConnectionState("connected");
    notifyConnected(true);
  };

  ws.onmessage = (e: MessageEvent) => {
    try {
      const event = JSON.parse(e.data as string) as WsEvent;
      // Guard against malformed events before dispatching
      if (!event || typeof event.type !== "string") return;
      dispatch(event);
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onclose = () => {
    reconnectAttempts++;
    notifyConnectionState(reconnectAttempts >= 10 ? "disconnected" : "reconnecting");
    notifyConnected(false);
    reconnectTimer = setTimeout(() => {
      delay = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY_MS);
      connect();
    }, delay);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function subscribe(handler: EventHandler): () => void {
  const id = Symbol();
  subscribers.push({ id, handler });
  if (subscribers.length === 1) {
    // First subscriber — open the connection
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connect();
  }
  return () => {
    const idx = subscribers.findIndex((s) => s.id === id);
    if (idx !== -1) subscribers.splice(idx, 1);
    if (subscribers.length === 0 && ws) {
      ws.close();
      ws = null;
    }
  };
}

// ---------------------------------------------------------------------------
// Hook — legacy single-handler API (backwards compatible)
// ---------------------------------------------------------------------------

export function useWebSocket(onEvent: EventHandler) {
  const [connected, setConnected] = useState(isConnected);
  const [connectionState, setConnectionState] = useState<ConnectionState>(moduleConnectionState);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  const stableHandler = useCallback((event: WsEvent) => {
    handlerRef.current(event);
  }, []);

  useEffect(() => {
    const notifyC = (v: boolean) => setConnected(v);
    const notifyS = (s: ConnectionState) => setConnectionState(s);
    connectedListeners.add(notifyC);
    connectionStateListeners.add(notifyS);
    setConnected(isConnected);
    setConnectionState(moduleConnectionState);

    const unsubscribe = subscribe(stableHandler);

    return () => {
      connectedListeners.delete(notifyC);
      connectionStateListeners.delete(notifyS);
      unsubscribe();
    };
  }, [stableHandler]);

  return { connected, connectionState };
}

// ---------------------------------------------------------------------------
// useWsSubscribe — typed subscriber for specific event types
// ---------------------------------------------------------------------------

export function useWsSubscribe(
  types: string | string[],
  handler: EventHandler,
  targetId?: string | null,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const typeSet = useRef(new Set(Array.isArray(types) ? types : [types]));

  const stableHandler = useCallback((event: WsEvent) => {
    if (!typeSet.current.has(event.type)) return;
    if (targetId !== undefined && targetId !== null && event.target_id !== targetId) return;
    handlerRef.current(event);
  }, [targetId]);

  useEffect(() => {
    return subscribe(stableHandler);
  }, [stableHandler]);
}
