import { useEffect, useState } from "react";

// ── Module-level singleton state ─────────────────────────────────────────────
let consecutiveFailures = 0;
let apiHealth: "ok" | "degraded" = "ok";
const healthListeners = new Set<(health: "ok" | "degraded") => void>();
const refreshCallbacks = new Set<() => void>();

function notifyHealth(h: "ok" | "degraded") {
  apiHealth = h;
  healthListeners.forEach((fn) => fn(h));
}

/** Call from polling hooks on any successful fetch. */
export function reportSuccess(): void {
  consecutiveFailures = 0;
  if (apiHealth !== "ok") notifyHealth("ok");
}

/** Call from polling hooks on any fetch error. Degrades after 3 consecutive failures. */
export function reportFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= 3 && apiHealth !== "degraded") notifyHealth("degraded");
}

/**
 * Register a callback to be called when forceRefreshAll() is triggered.
 * Returns an unregister function. Call from polling hooks' useEffect cleanup.
 */
export function registerRefreshCallback(cb: () => void): () => void {
  refreshCallbacks.add(cb);
  return () => refreshCallbacks.delete(cb);
}

/** Force all registered polling hooks to refresh immediately. */
export function forceRefreshAll(): void {
  refreshCallbacks.forEach((cb) => cb());
}

// ── React hook ───────────────────────────────────────────────────────────────
export function useApiHealth() {
  const [health, setHealth] = useState<"ok" | "degraded">(apiHealth);

  useEffect(() => {
    const listener = (h: "ok" | "degraded") => setHealth(h);
    healthListeners.add(listener);
    setHealth(apiHealth); // sync with current state on mount
    return () => { healthListeners.delete(listener); };
  }, []);

  return { health, forceRefreshAll };
}
