// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAdminPendingActions } from "./useAdminPendingActions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useAdminPendingActions", () => {
  it("tracks independent resources and synchronously rejects a duplicate target action", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const firstAction = vi.fn(() => first.promise);
    const duplicateAction = vi.fn(() => Promise.resolve());
    const secondAction = vi.fn(() => second.promise);
    const { result } = renderHook(() => useAdminPendingActions());

    let firstRun: Promise<void> | undefined;
    let secondRun: Promise<void> | undefined;
    act(() => {
      firstRun = result.current.runPendingAction(
        { resource: "invite", resourceId: "invite-1", action: "delete" },
        firstAction,
      );
      const duplicateRun = result.current.runPendingAction(
        { resource: "invite", resourceId: "invite-1", action: "delete" },
        duplicateAction,
      );
      secondRun = result.current.runPendingAction(
        { resource: "invite", resourceId: "invite-2", action: "delete" },
        secondAction,
      );
      expect(duplicateRun).toBeUndefined();
    });

    expect(firstAction).toHaveBeenCalledOnce();
    expect(duplicateAction).not.toHaveBeenCalled();
    expect(secondAction).toHaveBeenCalledOnce();
    expect(result.current.isActionPending({
      resource: "invite",
      resourceId: "invite-1",
      action: "delete",
    })).toBe(true);
    expect(result.current.isActionPending({
      resource: "invite",
      resourceId: "invite-2",
      action: "delete",
    })).toBe(true);

    await act(async () => {
      first.resolve();
      await firstRun;
    });
    expect(result.current.isActionPending({
      resource: "invite",
      resourceId: "invite-1",
      action: "delete",
    })).toBe(false);
    expect(result.current.isActionPending({
      resource: "invite",
      resourceId: "invite-2",
      action: "delete",
    })).toBe(true);

    await act(async () => {
      second.resolve();
      await secondRun;
    });
  });
});
