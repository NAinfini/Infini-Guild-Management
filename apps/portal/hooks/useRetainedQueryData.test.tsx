import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useRetainedQueryData } from "./useRetainedQueryData";

const state = vi.hoisted(() => ({ user: { id: "one" }, external: false }));
vi.mock("../stores/auth", () => ({ useAuthStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock("./useExternalView", () => ({ useExternalView: () => state.external }));

describe("retained list data", () => {
  it("retains filter results only for the same viewer and viewing mode", () => {
    const { result, rerender } = renderHook(() => useRetainedQueryData());
    const previous = { meta: result.current.meta };
    const data = { pages: ["existing result"] };
    expect(result.current.placeholderData(data, previous)).toBe(data);
    state.external = true;
    rerender();
    expect(result.current.placeholderData(data, previous)).toBeUndefined();
    state.external = false;
    state.user = { id: "two" };
    rerender();
    expect(result.current.placeholderData(data, previous)).toBeUndefined();
    expect(result.current.placeholderData(data, undefined)).toBeUndefined();
  });
});
