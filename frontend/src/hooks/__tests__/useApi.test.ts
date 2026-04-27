import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useApi } from "../useApi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useApi", () => {
  it("starts in loading=false, data=null state", () => {
    const { result } = renderHook(() => useApi<{ id: string }>());
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns data on a successful fetch", async () => {
    const payload = { id: "abc", domain: "example.com" };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(payload), { status: 200 }),
    );

    const { result } = renderHook(() => useApi<typeof payload>());
    await act(async () => {
      await result.current.request("/targets/abc", { retries: 1 });
    });

    expect(result.current.data).toEqual(payload);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sets error state on a 404 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Not found" }), { status: 404 }),
    );

    const { result } = renderHook(() => useApi<unknown>());
    await act(async () => {
      await result.current.request("/targets/missing", { retries: 1 });
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it("sets error state on a network failure (no retries)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network error"));

    const { result } = renderHook(() => useApi<unknown>());
    await act(async () => {
      await result.current.request("/targets/abc", { retries: 1 });
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.loading).toBe(false);
  });
});
