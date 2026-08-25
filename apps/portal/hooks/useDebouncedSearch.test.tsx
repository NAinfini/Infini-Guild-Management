import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedSearch } from "./useDebouncedSearch";

afterEach(() => {
  vi.useRealTimers();
});

describe("useDebouncedSearch", () => {
  it("publishes only the latest value after the requested delay", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDebouncedSearch(250));

    act(() => result.current.setSearch("guild"));
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.debouncedSearch).toBe("");

    act(() => result.current.setSearch("guild war"));
    act(() => vi.advanceTimersByTime(249));
    expect(result.current.debouncedSearch).toBe("");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.debouncedSearch).toBe("guild war");
  });
});
