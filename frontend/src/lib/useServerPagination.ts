import { useState, useEffect, useCallback, useRef } from "react";
import type { PaginatedResponse } from "@/types/api";
import { reportSuccess, reportFailure } from "@/hooks/useApiHealth";

export interface PaginationParams {
  page: number;
  perPage: number;
  q: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
}

export interface UseServerPagination<T> {
  data: T[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  perPage: number;
  q: string;
  sortBy: string | null;
  sortDir: "asc" | "desc";
  setPage: (p: number) => void;
  setQ: (q: string) => void;
  setSort: (col: string, dir: "asc" | "desc") => void;
  setPerPage: (n: number) => void;
  refresh: () => void;
}

/**
 * Generic server-side pagination hook.
 *
 * @param fetchFn   Async function receiving current params, returning PaginatedResponse<T>
 * @param defaults  Optional overrides for initial page/perPage/sortBy/sortDir
 */
export function useServerPagination<T>(
  fetchFn: (params: PaginationParams) => Promise<PaginatedResponse<T>>,
  defaults?: Partial<Pick<PaginationParams, "perPage" | "sortBy" | "sortDir">>
): UseServerPagination<T> {
  const [data, setData]       = useState<T[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const [page, setPageState]       = useState(1);
  const [perPage, setPerPageState] = useState(defaults?.perPage ?? 50);
  const [q, setQState]             = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sortBy, setSortBy]        = useState<string | null>(defaults?.sortBy ?? null);
  const [sortDir, setSortDir]      = useState<"asc" | "desc">(defaults?.sortDir ?? "desc");
  const [tick, setTick]            = useState(0);

  const abortRef = useRef<AbortController | null>(null);

  // Debounce q by 400ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 400);
    return () => clearTimeout(timer);
  }, [q]);

  // Reset to page 1 when filters/sort change (but not on q — debounce handles it)
  const setPage = useCallback((p: number) => setPageState(p), []);

  const setQ = useCallback((newQ: string) => {
    setQState(newQ);
    setPageState(1);
  }, []);

  const setSort = useCallback((col: string, dir: "asc" | "desc") => {
    setSortBy(col);
    setSortDir(dir);
    setPageState(1);
  }, []);

  const setPerPage = useCallback((n: number) => {
    setPerPageState(n);
    setPageState(1);
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Fetch when any param changes
  useEffect(() => {
    // Cancel previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    fetchFn({ page, perPage, q: debouncedQ, sortBy, sortDir })
      .then((res) => {
        if (controller.signal.aborted) return;
        setData(res.data);
        setTotal(res.total);
        setLoading(false);
        reportSuccess();
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
        reportFailure();
      });

    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, perPage, debouncedQ, sortBy, sortDir, tick]);

  return {
    data, total, loading, error,
    page, perPage, q, sortBy, sortDir,
    setPage, setQ, setSort, setPerPage, refresh,
  };
}
