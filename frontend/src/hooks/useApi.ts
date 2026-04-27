import { useState, useCallback } from "react";

const BASE = "/api/v1";

export interface ApiState<T> {
  data: T | null;
  loading: boolean;
  retrying: boolean;
  error: string | null;
}

interface RequestOptions extends RequestInit {
  /** Max retry attempts on network error or 5xx. Default: 3 */
  retries?: number;
  /** Abort timeout in ms. Default: 15 000 */
  timeoutMs?: number;
}

function friendlyError(status: number, detail?: string): string {
  if (detail) return detail;
  if (status === 404) return "Not found";
  if (status === 403) return "Forbidden";
  if (status === 422) return "Invalid request";
  if (status >= 500) return "Server error";
  return `HTTP ${status}`;
}

const RETRY_DELAYS = [500, 1500];

export function useApi<T>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    retrying: false,
    error: null,
  });

  const request = useCallback(
    async (
      path: string,
      options: RequestOptions = {}
    ): Promise<T | null> => {
      const { retries = 3, timeoutMs = 15_000, ...fetchOptions } = options;

      setState({ data: null, loading: true, retrying: false, error: null });

      let attempt = 0;
      while (attempt < retries) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await fetch(`${BASE}${path}`, {
            headers: { "Content-Type": "application/json" },
            ...fetchOptions,
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const msg = friendlyError(
              res.status,
              (body as { detail?: string; error?: string }).detail ??
                (body as { detail?: string; error?: string }).error
            );
            // Only retry on server errors (5xx)
            if (res.status >= 500 && attempt < retries - 1) {
              attempt++;
              setState((s) => ({ ...s, retrying: true }));
              await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1] ?? 2000));
              continue;
            }
            throw new Error(msg);
          }

          const data = (await res.json()) as T;
          setState({ data, loading: false, retrying: false, error: null });
          return data;
        } catch (err) {
          clearTimeout(timer);
          const isAbort = err instanceof DOMException && err.name === "AbortError";
          const msg = isAbort ? "Request timed out" : (err instanceof Error ? err.message : String(err));

          // Retry on network errors (not abort, not 4xx)
          if (!isAbort && attempt < retries - 1 && !(err instanceof Error && err.message.startsWith("HTTP"))) {
            attempt++;
            setState((s) => ({ ...s, retrying: true }));
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1] ?? 2000));
            continue;
          }

          setState({ data: null, loading: false, retrying: false, error: msg });
          return null;
        }
      }

      setState({ data: null, loading: false, retrying: false, error: "Request failed" });
      return null;
    },
    []
  );

  return { ...state, request };
}
